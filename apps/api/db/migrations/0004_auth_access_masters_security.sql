-- T-104 security for the auth, access and masters tables of migration 0003 (ADR 0003, ADR 0014,
-- ADR 0015). Runs as ekaro_owner.

------------------------------------------------------------------------------------------------
-- Platform tables: users and refresh_tokens. Only ekaro_platform (modules/platform and
-- modules/auth) can reach them; ekaro_app gets no grant at all. RLS is forced like on `tenants`,
-- so a future grant to another role would still see nothing without an explicit policy.
-- No DELETE for anyone: users are disabled and refresh tokens revoked, never removed.
------------------------------------------------------------------------------------------------
alter table users enable row level security;
alter table users force row level security;
create policy platform_all on users to ekaro_platform using (true) with check (true);
grant select, insert, update on users to ekaro_platform;

alter table refresh_tokens enable row level security;
alter table refresh_tokens force row level security;
create policy platform_all on refresh_tokens to ekaro_platform using (true) with check (true);
grant select, insert, update on refresh_tokens to ekaro_platform;

------------------------------------------------------------------------------------------------
-- Tenant tables: RLS enabled and forced, tenant_isolation policy, DML for ekaro_app, audit trigger.
------------------------------------------------------------------------------------------------
select app_enable_tenant_table('roles');
select app_enable_tenant_table('memberships');
select app_enable_tenant_table('membership_branches');
select app_enable_tenant_table('company_profile');
select app_enable_tenant_table('branches');
select app_enable_tenant_table('godowns');
select app_enable_tenant_table('units');
select app_enable_tenant_table('tax_rates');
select app_enable_tenant_table('document_series');

-- Login lists a user's tenants before any tenant is chosen, and the session loader reads the
-- membership, role and branch scope behind an access token: cross-tenant, read-only.
select app_grant_platform_read('roles');
select app_grant_platform_read('memberships');
select app_grant_platform_read('membership_branches');
select app_grant_platform_read('company_profile');

-- Signup bootstrap seeds a new tenant on the platform connection with app.tenant_id set to that
-- tenant. INSERT passes the ordinary tenant_isolation check. SELECT on the tables without a
-- platform_read policy is limited by tenant_isolation to the tenant in context, which lets the
-- idempotent bootstrap find rows an earlier run created (ON CONFLICT DO NOTHING, then read back).
grant select, insert on
  roles, memberships, membership_branches, company_profile,
  branches, godowns, units, tax_rates, document_series
  to ekaro_platform;
