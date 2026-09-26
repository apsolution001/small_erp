-- Security review of T-104 (ADR 0016). Runs as ekaro_owner.

------------------------------------------------------------------------------------------------
-- sessions: a platform table like users and refresh_tokens. Only ekaro_platform (modules/auth)
-- reaches it; ekaro_app gets no grant. RLS is forced. No DELETE: sessions are revoked, never
-- removed.
------------------------------------------------------------------------------------------------
alter table sessions enable row level security;
alter table sessions force row level security;
create policy platform_all on sessions to ekaro_platform using (true) with check (true);
grant select, insert, update on sessions to ekaro_platform;

------------------------------------------------------------------------------------------------
-- The signup bootstrap only inserts into godowns, units, tax_rates and document_series: it never
-- reads them back (their seeds use a bare ON CONFLICT DO NOTHING, which needs no SELECT). Drop the
-- SELECT that migration 0004 granted. It stays on branches, whose head office is read back, and on
-- the platform_read tables.
------------------------------------------------------------------------------------------------
revoke select on godowns, units, tax_rates, document_series from ekaro_platform;
