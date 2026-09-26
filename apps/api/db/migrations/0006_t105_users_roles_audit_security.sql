-- T-105 security for users, invitations, roles and the audit log (ADR 0008, ADR 0011, ADR 0016).
-- Runs as ekaro_owner.

------------------------------------------------------------------------------------------------
-- 1. Audit rows always carry the audited row's key (ADR 0016 §3).
-- audit_row_change() takes the key column as an optional trigger argument (default `id`), so a
-- table keyed otherwise names its key: company_profile is keyed by tenant_id, and a
-- membership_branches row is a fact about its membership (row_id = membership_id).
------------------------------------------------------------------------------------------------
create or replace function audit_row_change() returns trigger
  language plpgsql
  as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_key text := case when tg_nargs > 0 then tg_argv[0] else 'id' end;
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
    (v_row ->> v_key)::uuid,
    tg_op,
    v_old,
    v_new,
    app_current_user(),
    app_current_request()
  );
  return null;
end
$$;

-- app_enable_tenant_table(t [, row_key]): as before (ADR 0003), plus the audit key column. The
-- single-argument call keeps working, so tables enabled elsewhere need no change.
drop function app_enable_tenant_table(regclass);

create function app_enable_tenant_table(p_table regclass, p_row_key text default 'id') returns void
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
  if not exists (
    select 1
    from pg_attribute
    where attrelid = p_table
      and attname = p_row_key
      and atttypid = 'uuid'::regtype
      and attnotnull
      and not attisdropped
  ) then
    raise exception 'app_enable_tenant_table: audit key %.% must be a "uuid not null" column', p_table, p_row_key;
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
    ' for each row execute function audit_row_change(%L)',
    p_table,
    p_row_key
  );
end
$$;

select app_enable_tenant_table('company_profile', 'tenant_id');
select app_enable_tenant_table('membership_branches', 'membership_id');

-- Backfill the rows written before the key was configured. audit_log is append-only for every
-- runtime role; the owner lifts FORCE for these two statements only (inside this migration's
-- transaction), so the rows of every tenant are reachable.
alter table audit_log no force row level security;
update audit_log
   set row_id = (coalesce(new_data, old_data) ->> 'tenant_id')::uuid
 where table_name = 'company_profile' and row_id is null;
update audit_log
   set row_id = (coalesce(new_data, old_data) ->> 'membership_id')::uuid
 where table_name = 'membership_branches' and row_id is null;
alter table audit_log force row level security;

------------------------------------------------------------------------------------------------
-- 2. invitations (tenant table): RLS, audit, the role reference, and the accept path.
------------------------------------------------------------------------------------------------
select app_enable_tenant_table('invitations');

-- Composite, so an invitation can never name another tenant's role. ON DELETE SET NULL (role_id)
-- only: a role may go once every invitation holding it is closed, which keeps their history;
-- invitations_role_while_pending makes the delete fail while one is still pending.
alter table invitations
  add constraint invitations_role_fk foreign key (tenant_id, role_id)
  references roles (tenant_id, id) on delete set null (role_id);

-- Accepting an invitation is public: the token hash finds the invitation before any tenant is
-- known. ekaro_platform then sets app.tenant_id to the invitation's tenant, so its UPDATE (closing
-- the invitation) passes the ordinary tenant_isolation policy, and so do the membership inserts.
select app_grant_platform_read('invitations');
grant update on invitations to ekaro_platform;

------------------------------------------------------------------------------------------------
-- 3. outbox (ADR 0011): tenant-scoped delivery queue. RLS forced; ekaro_app may only INSERT,
-- because payloads carry bearer secrets (invitation links). Not audited on purpose: auditing would
-- copy those secrets into audit_log; the change that enqueues a message is audited instead.
-- The relay worker's access is granted with the worker (later).
------------------------------------------------------------------------------------------------
alter table outbox enable row level security;
alter table outbox force row level security;
create policy tenant_isolation on outbox
  using (tenant_id = (select app_current_tenant()))
  with check (tenant_id = (select app_current_tenant()));
grant insert on outbox to ekaro_app;

------------------------------------------------------------------------------------------------
-- 4. The user directory for tenant code (ADR 0016 §1). users stays a platform table; ekaro_app
-- may read five columns of the users who hold a membership in the tenant in context, and nothing
-- else: no password hash, TOTP secret, lockout state, and no user of any other tenant.
------------------------------------------------------------------------------------------------
grant select (id, email, full_name, mobile, status) on users to ekaro_app;

-- The subquery runs as ekaro_app, so memberships' own tenant_isolation limits it to the tenant in
-- context: a user is visible exactly while one of this tenant's memberships points at them.
create policy tenant_member_read on users for select to ekaro_app
  using (exists (select 1 from memberships m where m.user_id = users.id));

-- The named read surface (Drizzle `tenantUsers`). security_invoker: the view adds no privilege,
-- it reads under the caller's grants and policies above.
create view tenant_users with (security_invoker = true) as
  select id, email, full_name, mobile, status from users;
grant select on tenant_users to ekaro_app;
