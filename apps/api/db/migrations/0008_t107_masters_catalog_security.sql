-- T-107 security and guards for the catalog tables of migration 0007 (spec 02, ADR 0003).
-- Runs as ekaro_owner.

------------------------------------------------------------------------------------------------
-- Tenant tables: RLS enabled and forced, tenant_isolation policy, DML for ekaro_app, audit trigger.
------------------------------------------------------------------------------------------------
select app_enable_tenant_table('item_categories');
select app_enable_tenant_table('items');
select app_enable_tenant_table('item_units');
select app_enable_tenant_table('item_tax_rates');

-- Effective-dated item tax rates are history: a rate change adds a row, documents dated before
-- it keep the old slab. No runtime role may edit or remove a row.
revoke update, delete on item_tax_rates from ekaro_app;

------------------------------------------------------------------------------------------------
-- A GST slab is immutable in its rates and flags once created (spec 02 §2, accounting standard):
-- documents already reference it. The API accepts only `name` and `is_active` on update; this
-- trigger holds the rule for any other writer too.
------------------------------------------------------------------------------------------------
create function tax_rates_rates_immutable() returns trigger
  language plpgsql
  as $$
begin
  if (new.gst_rate, new.cess_rate, new.is_exempt, new.is_nil_rated, new.is_non_gst)
     is distinct from
     (old.gst_rate, old.cess_rate, old.is_exempt, old.is_nil_rated, old.is_non_gst) then
    raise exception 'The rates of tax slab % are immutable; create a new slab instead', old.id
      using errcode = 'check_violation', constraint = 'tax_rates_rates_immutable';
  end if;
  return new;
end
$$;

create trigger tax_rates_rates_immutable
  before update on tax_rates
  for each row execute function tax_rates_rates_immutable();
