/**
 * One-command bootstrap (idempotent):
 *   1. generates ED25519_PRIVATE_KEY / NEXT_PUBLIC_ED25519_PUBLIC_KEY and DEMO_RESET_SECRET into .env.local if missing
 *   2. if Supabase keys are present: ensures the protected stage user (STAGE_EMAIL / STAGE_PASSWORD) exists
 *      and owns the stage shop created by supabase/seed.sql
 *
 *   npm run setup
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { generateKeypairHex, publicKeyFromPrivate } from "../src/lib/crypto/passport";

const envPath = path.resolve(__dirname, "../.env.local");

function readEnv(): Record<string, string> {
  if (!existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function appendEnv(pairs: Record<string, string>) {
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const add = Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join("\n");
  writeFileSync(envPath, `${existing.replace(/\s*$/, "")}${existing ? "\n" : ""}${add}\n`);
}

async function main() {
  const env = { ...readEnv(), ...process.env } as Record<string, string | undefined>;
  const added: Record<string, string> = {};

  if (!env.ED25519_PRIVATE_KEY) {
    const kp = await generateKeypairHex();
    added.ED25519_PRIVATE_KEY = kp.privateKey;
    added.NEXT_PUBLIC_ED25519_PUBLIC_KEY = kp.publicKey;
  } else if (!env.NEXT_PUBLIC_ED25519_PUBLIC_KEY) {
    added.NEXT_PUBLIC_ED25519_PUBLIC_KEY = await publicKeyFromPrivate(env.ED25519_PRIVATE_KEY);
  }
  if (!env.DEMO_RESET_SECRET) added.DEMO_RESET_SECRET = randomBytes(18).toString("base64url");
  let stagePassword = env.STAGE_PASSWORD;
  if (!stagePassword) {
    stagePassword = String(100000 + (randomBytes(4).readUInt32BE() % 900000)); // 6-digit stage PIN
    added.STAGE_PASSWORD = stagePassword;
  }
  if (Object.keys(added).length) {
    appendEnv(added);
    console.log(`✓ wrote ${Object.keys(added).join(", ")} to .env.local`);
  } else {
    console.log("✓ keys already present in .env.local");
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) {
    console.log("… Supabase keys not set yet — add them, run `npm run db:apply`, then re-run `npm run setup`.");
    return;
  }
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = env.STAGE_EMAIL || "stage@dukaanos.pk";

  // find or create the stage user
  let userId: string | null = null;
  for (let page = 1; page < 20 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email === email)?.id ?? null;
    if (data.users.length < 200) break;
  }
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: stagePassword, email_confirm: true, user_metadata: { kind: "stage" } });
    if (error) throw error;
    userId = data.user!.id;
    console.log(`✓ created stage user ${email}`);
  } else {
    await admin.auth.admin.updateUserById(userId, { password: stagePassword });
    console.log(`✓ stage user ${email} exists (password synced from STAGE_PASSWORD)`);
  }

  const { data: shops, error: shopErr } = await admin.from("shops").select("id").eq("is_stage_shop", true).limit(1);
  if (shopErr) throw shopErr;
  let stageShop = shops?.[0]?.id as string | undefined;
  if (!stageShop) {
    const { data, error } = await admin.rpc("create_demo_shop", { p_user_id: userId, p_kind: "stage" });
    if (error) throw error;
    stageShop = data as string;
    console.log("✓ created + seeded stage shop");
  } else {
    const { error } = await admin.rpc("link_shop_member", { p_shop_id: stageShop, p_user_id: userId, p_role: "owner" });
    if (error) throw error;
  }
  console.log(`✓ stage shop ${stageShop} owned by ${email} · stage PIN is STAGE_PASSWORD in .env.local`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
