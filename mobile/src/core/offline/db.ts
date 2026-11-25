import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import type { ShopState } from "@/core/api/types";

let dbInstance: SQLite.SQLiteDatabase | null = null;

export function getMobileDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync("dukaanos.db");
    dbInstance.execSync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pending_turns (
        key TEXT PRIMARY KEY NOT NULL,
        shop_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_uri TEXT,
        mime TEXT,
        text TEXT,
        created_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        review_kind TEXT,
        proposal_json TEXT,
        target_json TEXT,
        trace_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pending_turns_shop_created ON pending_turns(shop_id, created_at);

      CREATE TABLE IF NOT EXISTS shop_state_cache (
        shop_id TEXT PRIMARY KEY NOT NULL,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS replay_clips (
        id TEXT PRIMARY KEY NOT NULL,
        file_uri TEXT NOT NULL,
        mime TEXT NOT NULL,
        transcript TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }
  return dbInstance;
}

export function getKv(key: string): string | null {
  try {
    const row = getMobileDb().getFirstSync<{ value: string }>("SELECT value FROM kv_store WHERE key = ?", [key]);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function setKv(key: string, value: string | null): void {
  try {
    const db = getMobileDb();
    if (value === null) {
      db.runSync("DELETE FROM kv_store WHERE key = ?", [key]);
    } else {
      db.runSync(
        "INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
      );
    }
  } catch {
    // Ignore local preference persistence errors.
  }
}

export function saveCachedShopState(shopId: string, state: ShopState): void {
  try {
    getMobileDb().runSync(
      "INSERT INTO shop_state_cache (shop_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(shop_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
      [shopId, JSON.stringify(state), Date.now()],
    );
  } catch {
    // Cache writes are best-effort.
  }
}

export function readCachedShopState(shopId: string): { state: ShopState; updatedAt: number } | null {
  try {
    const row = getMobileDb().getFirstSync<{ state_json: string; updated_at: number }>(
      "SELECT state_json, updated_at FROM shop_state_cache WHERE shop_id = ?",
      [shopId],
    );
    if (!row) return null;
    return { state: JSON.parse(row.state_json) as ShopState, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export function clearQueueAndCacheStorage(): void {
  try {
    const db = getMobileDb();
    db.execSync(`
      DELETE FROM pending_turns;
      DELETE FROM shop_state_cache;
      DELETE FROM replay_clips;
      DELETE FROM kv_store WHERE key = 'dukaanos.shop';
    `);
  } catch {
    // Ignore DB clear errors during sign-out.
  }
  for (const folder of ["queue", "replays"]) {
    try {
      const dir = new Directory(Paths.document, folder);
      if (dir.exists) dir.delete();
    } catch {
      // Ignore cleanup errors.
    }
  }
}

export async function copyToQueueDirectory(sourceUri: string, key: string, mime?: string): Promise<string> {
  const queueDir = new Directory(Paths.document, "queue");
  if (!queueDir.exists) queueDir.create({ intermediates: true, idempotent: true });
  const ext = mime?.includes("webm") ? "webm" : mime?.includes("wav") ? "wav" : mime?.includes("ogg") ? "ogg" : "m4a";
  const dest = new File(queueDir, `${key}.${ext}`);
  const src = new File(sourceUri);
  if (src.exists) {
    await src.copy(dest);
    return dest.uri;
  }
  return sourceUri;
}

export function deleteQueueFile(fileUri: string | null | undefined): void {
  if (!fileUri) return;
  try {
    const f = new File(fileUri);
    if (f.exists) f.delete();
  } catch {
    // Ignore missing/already removed file.
  }
}

export interface ReplayClipRow {
  id: string;
  file_uri: string;
  mime: string;
  transcript: string;
  created_at: number;
}

export async function saveReplayClip(clip: { id: string; sourceUri: string; mime: string; transcript: string }): Promise<void> {
  try {
    const replayDir = new Directory(Paths.document, "replays");
    if (!replayDir.exists) replayDir.create({ intermediates: true, idempotent: true });
    const ext = clip.mime.includes("webm") ? "webm" : clip.mime.includes("wav") ? "wav" : "m4a";
    const dest = new File(replayDir, `${clip.id}.${ext}`);
    const src = new File(clip.sourceUri);
    const savedUri = src.exists ? (await src.copy(dest), dest.uri) : clip.sourceUri;

    const db = getMobileDb();
    db.runSync(
      "INSERT OR REPLACE INTO replay_clips (id, file_uri, mime, transcript, created_at) VALUES (?, ?, ?, ?, ?)",
      [clip.id, savedUri, clip.mime, clip.transcript, Date.now()],
    );
    const all = db.getAllSync<ReplayClipRow>("SELECT * FROM replay_clips ORDER BY created_at DESC");
    for (const stale of all.slice(12)) {
      db.runSync("DELETE FROM replay_clips WHERE id = ?", [stale.id]);
      deleteQueueFile(stale.file_uri);
    }
  } catch {
    // Replay archive is best-effort.
  }
}

export function listReplayClips(): ReplayClipRow[] {
  try {
    return getMobileDb().getAllSync<ReplayClipRow>("SELECT * FROM replay_clips ORDER BY created_at DESC");
  } catch {
    return [];
  }
}
