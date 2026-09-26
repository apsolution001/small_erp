-- T-103 tenancy + audit (ADR 0003, ADR 0008): tenants access rules, the monthly-partitioned
-- audit_log, the generic audit trigger, and the helpers every tenant-table migration calls.

------------------------------------------------------------------------------------------------
-- tenants (platform table). ekaro_platform manages it; ekaro_app may read only the row of the
-- tenant in the current transaction context (narrower than a plain SELECT grant).
------------------------------------------------------------------------------------------------
alter table tenants enable row level security;
alter table tenants force row level security;

create policy platform_all on tenants to ekaro_platform using (true) with check (true);
create policy tenant_self_read on tenants for select to ekaro_app
  using (id = (select app_current_tenant()));

grant select, insert, update on tenants to ekaro_platform;
grant select on tenants to ekaro_app;

------------------------------------------------------------------------------------------------
-- audit_log: append-only, one row per changed tenant row, partitioned by month on changed_at
-- (8-year retention, BRD §10: old partitions are detached/archived, never deleted row by row).
-- No FK to tenants, to keep the write path cheap; tenant_id always comes from an RLS-checked row.
------------------------------------------------------------------------------------------------
create table audit_log (
  id uuid not null default app_uuidv7(),
  tenant_id uuid not null,
  table_name text not null,
  -- NULL for tables without a single `id` column (for example composite-key link tables).
  row_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  request_id text,
  constraint audit_log_pkey primary key (id, changed_at),
  constraint audit_log_action_valid check (action in ('INSERT', 'UPDATE', 'DELETE')),
  constraint audit_log_data_matches_action check (
    (action = 'INSERT' and old_data is null and new_data is not null)
    or (action = 'UPDATE' and old_data is not null and new_data is not null)
    or (action = 'DELETE' and old_data is not null and new_data is null)
  )
) partition by range (changed_at);

-- Audit screens (T-105): per tenant by time, per record, per user. Keyset on (changed_at, id).
create index audit_log_tenant_changed_idx on audit_log (tenant_id, changed_at desc, id desc);
create index audit_log_tenant_row_idx on audit_log (tenant_id, table_name, row_id, changed_at desc);
create index audit_log_tenant_user_idx on audit_log (tenant_id, changed_by, changed_at desc);

alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy tenant_isolation on audit_log
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));

-- Append-only: no UPDATE or DELETE for any runtime role. The trigger runs as the writing role,
-- so ekaro_platform (signup bootstrap writes tenant rows) needs INSERT as well.
-- Partitions get no grants: they are reachable only through the parent, where RLS applies.
grant select, insert on audit_log to ekaro_app;
grant insert on audit_log to ekaro_platform;

-- Creates the monthly partitions from the current month (UTC) up to `months_ahead` months ahead.
-- Idempotent. A monthly scheduled job (worker, T-5xx) calls it so there are always 12 months
-- ahead; there is deliberately no DEFAULT partition, whose rows would block creating the month.
-- SECURITY DEFINER so that job can run as ekaro_app, which has no DDL rights of its own.
create function app_ensure_audit_partitions(months_ahead integer default 12) returns integer
  language plpgsql security definer
  set search_path = public, pg_temp
  as $$
declare
  v_first date := date_trunc('month', now() at time zone 'UTC')::date;
  v_from date;
  v_name text;
  v_created integer := 0;
begin
  if months_ahead is null or months_ahead < 0 or months_ahead > 120 then
    raise exception 'months_ahead must be between 0 and 120, got %', months_ahead;
  end if;
  perform pg_advisory_xact_lock(hashtext('ekaro:audit_partitions'));
  for i in 0..months_ahead loop
    v_from := (v_first + make_interval(months => i))::date;
    v_name := format('audit_log_p%s', to_char(v_from, 'YYYY_MM'));
    if to_regclass(v_name) is null then
      execute format(
        'create table %I partition of audit_log for values from (%L) to (%L)',
        v_name,
        v_from::timestamp at time zone 'UTC',
        (v_from + interval '1 month')::timestamp at time zone 'UTC'
      );
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end
$$;

grant execute on function app_ensure_audit_partitions(integer) to ekaro_app;

select app_ensure_audit_partitions(12);

------------------------------------------------------------------------------------------------
-- audit_row_change(): AFTER INSERT/UPDATE/DELETE FOR EACH ROW on every tenant table.
-- Runs as the writing role (SECURITY INVOKER), so the audit row passes the same tenant check.
------------------------------------------------------------------------------------------------
create function audit_row_change() returns trigger
  language plpgsql
  as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    -- ADR 0008: an UPDATE that changes nothing is not audited.
    if v_old = v_new then
      return null;
    end if;
  else
    v_old := to_jsonb(old);
  end if;
  v_row := coalesce(v_new, v_old);

  insert into audit_log (tenant_id, table_name, row_id, action, old_data, new_data, changed_by, request_id)
  values (
    (v_row ->> 'tenant_id')::uuid,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    tg_op,
    v_old,
    v_new,
    app_current_user(),
    app_current_request()
  );
  return null;
end
$$;

------------------------------------------------------------------------------------------------
-- app_enable_tenant_table(t): the one call every tenant-table migration makes (ADR 0003).
-- Enable + force RLS, the tenant_isolation policy, DML grants to ekaro_app, the audit trigger.
-- Idempotent. Executable by the owner (migrations) only.
------------------------------------------------------------------------------------------------
create function app_enable_tenant_table(p_table regclass) returns void
  language plpgsql
  as $$
begin
  if not exists (
    select 1
    from pg_attribute
    where attrelid = p_table
      and attname = 'tenant_id'
      and atttypid = 'uuid'::regtype
      and attnotnull
      and not attisdropped
  ) then
    raise exception 'app_enable_tenant_table: % must have a "tenant_id uuid not null" column', p_table;
  end if;

  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format('drop policy if exists tenant_isolation on %s', p_table);
  execute format(
    'create policy tenant_isolation on %s'
    ' using (tenant_id = (select app_current_tenant()))'
    ' with check (tenant_id = (select app_current_tenant()))',
    p_table
  );
  execute format('grant select, insert, update, delete on %s to ekaro_app', p_table);
  execute format('drop trigger if exists audit_row_change on %s', p_table);
  execute format(
    'create trigger audit_row_change after insert or update or delete on %s'
    ' for each row execute function audit_row_change()',
    p_table
  );
end
$$;

-- app_grant_platform_read(t): lets ekaro_platform read every tenant's rows of `t` (login lists a
-- user's tenants: memberships, roles, company_profile). Writes by ekaro_platform still pass the
-- tenant_isolation check. Idempotent. Executable by the owner (migrations) only.
create function app_grant_platform_read(p_table regclass) returns void
  language plpgsql
  as $$
begin
  execute format('drop policy if exists platform_read on %s', p_table);
  execute format('create policy platform_read on %s for select to ekaro_platform using (true)', p_table);
  execute format('grant select on %s to ekaro_platform', p_table);
end
$$;
