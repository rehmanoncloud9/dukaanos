/**
 * Applies supabase/migrations/*.sql (in order, once each) and supabase/seed.sql to the
 * database in DATABASE_URL (Supabase → Settings → Database → Connection string, "Session" pooler).
 *
 *   npm run db:apply            # migrations + seed
 *   npm run db:apply -- --no-seed
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const root = path.resolve(__dirname, "..");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (add it to .env.local)");
    process.exit(1);
  }
  const client = new Client({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });
  await client.connect();
  await client.query(`create schema if not exists private;
    create table if not exists private._migrations (name text primary key, applied_at timestamptz not null default now());`);

  const dir = path.join(root, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await client.query<{ name: string }>("select name from private._migrations");
  const applied = new Set(rows.map((r) => r.name));
  const regenerated = new Set(["20261124000003_demo.sql"]); // generated file: always re-applied (create or replace only)

  for (const f of files) {
    if (applied.has(f) && !regenerated.has(f)) {
      console.log(`· skip ${f}`);
      continue;
    }
    const sql = readFileSync(path.join(dir, f), "utf8");
    process.stdout.write(`→ apply ${f} … `);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into private._migrations (name) values ($1) on conflict (name) do update set applied_at = now()", [f]);
      await client.query("commit");
      console.log("ok");
    } catch (e) {
      await client.query("rollback");
      console.log("FAILED");
      throw e;
    }
  }

  if (!process.argv.includes("--no-seed")) {
    process.stdout.write("→ seed.sql … ");
    const t0 = Date.now();
    await client.query(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
    console.log(`ok (${Date.now() - t0} ms)`);
  }
  const { rows: shops } = await client.query("select id, name, is_stage_shop, is_demo_shop from public.shops order by created_at");
  console.table(shops);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
