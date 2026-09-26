-- T-103 foundation: extensions, the transaction-context functions that RLS policies and the audit
-- trigger read, and deny-by-default privileges. Runs as ekaro_owner, which owns every object.
-- The login roles themselves (ekaro_owner, ekaro_app, ekaro_platform) are cluster-level and are
-- created by apps/api/scripts/setup-local-db.sh (or the platform's IaC in hosted environments).

-- citext: case-insensitive emails/codes. pgcrypto: digest()/gen_random_bytes(). Both are trusted
-- extensions, so the database owner may create them.
create extension if not exists citext;
create extension if not exists pgcrypto;

-- Only the owner creates objects. The runtime roles get exactly what each migration grants.
revoke all on schema public from public;
grant usage on schema public to ekaro_app, ekaro_platform;

-- Functions created by ekaro_owner are not executable by PUBLIC unless granted explicitly.
alter default privileges for role ekaro_owner revoke execute on functions from public;
-- Identity/serial columns must stay insertable by the runtime roles; table rights stay per table.
alter default privileges for role ekaro_owner in schema public
  grant usage, select on sequences to ekaro_app, ekaro_platform;

-- Transaction context (ADR 0003). Set per transaction with set_config(..., true) by the API
-- (TenantTxInterceptor / TenantContext.runInTenant). An unset or empty setting reads as NULL, so
-- `tenant_id = app_current_tenant()` matches no row and every insert fails its check: fail closed.
create function app_current_tenant() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create function app_current_user() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Request ids are opaque strings (x-request-id from a proxy, or a generated UUIDv7).
create function app_current_request() returns text
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.request_id', true), '') $$;

grant execute on function app_current_tenant(), app_current_user(), app_current_request()
  to ekaro_app, ekaro_platform;

-- UUIDv7 (RFC 9562) for keys generated inside the database (audit rows). The app generates all
-- other ids with uuidv7() from @ekaro/core. 48-bit Unix ms timestamp, then version 7 bits over
-- the random v4 layout (version nibble 0100 -> 0111; the variant bits are already 10).
create function app_uuidv7() returns uuid
  language sql volatile parallel safe
  as $$
    select encode(
      set_bit(
        set_bit(
          overlay(
            uuid_send(gen_random_uuid())
            placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
            from 1 for 6
          ),
          52, 1
        ),
        53, 1
      ),
      'hex'
    )::uuid
  $$;

grant execute on function app_uuidv7() to ekaro_app, ekaro_platform;
