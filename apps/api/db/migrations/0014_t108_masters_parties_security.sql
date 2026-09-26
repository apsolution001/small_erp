-- T-108 security for the party tables of migration 0013 (spec 02, ADR 0003). Runs as ekaro_owner.
-- RLS enabled and forced, tenant_isolation policy, DML for ekaro_app, audit trigger.
select app_enable_tenant_table('parties');
select app_enable_tenant_table('party_addresses');
