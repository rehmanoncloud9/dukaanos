import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 1600;
const STORE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

function safeKey(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : "k";
}

function metaKey(base: string): string {
  return `${base}.__chunks`;
}

function chunkKey(base: string, index: number): string {
  return `${base}.__c${index}`;
}

export interface SecureStorageBackend {
  getItemAsync: (key: string, options?: SecureStore.SecureStoreOptions) => Promise<string | null>;
  setItemAsync: (key: string, value: string, options?: SecureStore.SecureStoreOptions) => Promise<void>;
  deleteItemAsync: (key: string, options?: SecureStore.SecureStoreOptions) => Promise<void>;
}

export function createChunkedSecureStorage(backend: SecureStorageBackend = SecureStore) {
  return {
    async getItem(key: string): Promise<string | null> {
      const base = safeKey(key);
      const rawCount = await backend.getItemAsync(metaKey(base), STORE_OPTS);
      if (rawCount !== null) {
        const count = Number(rawCount);
        if (!Number.isInteger(count) || count <= 0) return null;
        const parts: string[] = [];
        for (let i = 0; i < count; i++) {
          const part = await backend.getItemAsync(chunkKey(base, i), STORE_OPTS);
          if (part === null) return null;
          parts.push(part);
        }
        return parts.join("");
      }
      return backend.getItemAsync(base, STORE_OPTS);
    },

    async setItem(key: string, value: string): Promise<void> {
      const base = safeKey(key);
      const prevRaw = await backend.getItemAsync(metaKey(base), STORE_OPTS);
      const prevCount = prevRaw && Number.isInteger(Number(prevRaw)) ? Number(prevRaw) : 0;

      if (value.length <= CHUNK_SIZE) {
        await backend.setItemAsync(base, value, STORE_OPTS);
        await backend.deleteItemAsync(metaKey(base), STORE_OPTS).catch(() => undefined);
        for (let i = 0; i < prevCount; i++) {
          await backend.deleteItemAsync(chunkKey(base, i), STORE_OPTS).catch(() => undefined);
        }
        return;
      }

      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      for (let i = 0; i < chunks.length; i++) {
        await backend.setItemAsync(chunkKey(base, i), chunks[i], STORE_OPTS);
      }
      await backend.setItemAsync(metaKey(base), String(chunks.length), STORE_OPTS);
      await backend.deleteItemAsync(base, STORE_OPTS).catch(() => undefined);
      for (let i = chunks.length; i < prevCount; i++) {
        await backend.deleteItemAsync(chunkKey(base, i), STORE_OPTS).catch(() => undefined);
      }
    },

    async removeItem(key: string): Promise<void> {
      const base = safeKey(key);
      const rawCount = await backend.getItemAsync(metaKey(base), STORE_OPTS).catch(() => null);
      const count = rawCount && Number.isInteger(Number(rawCount)) ? Number(rawCount) : 0;
      await backend.deleteItemAsync(base, STORE_OPTS).catch(() => undefined);
      await backend.deleteItemAsync(metaKey(base), STORE_OPTS).catch(() => undefined);
      for (let i = 0; i < count; i++) {
        await backend.deleteItemAsync(chunkKey(base, i), STORE_OPTS).catch(() => undefined);
      }
    },
  };
}

export const secureStorage = createChunkedSecureStorage();
