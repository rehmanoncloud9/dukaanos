/**
 * Boots a real Postgres (PGlite/WASM) with minimal Supabase stand-ins (auth schema, roles,
 * extensions schema) and applies the actual migrations + seed — no Docker, no network.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const root = path.resolve(__dirname, "../..");

const SUPABASE_STUBS = `
create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
`;

export async function bootDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_STUBS);
  const dir = path.join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  }
  await db.exec(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
  return db;
}

/** Run a callback as a PostgREST-style authenticated user: role = authenticated + JWT claims. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false);
    select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${userId}"}', false);
    set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;
      select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`);
  }
}

export async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}
