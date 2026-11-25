import { createChunkedSecureStorage, type SecureStorageBackend } from "@/core/auth/storage";

function makeMemoryBackend() {
  const map = new Map<string, string>();
  const backend: SecureStorageBackend = {
    getItemAsync: jest.fn(async (key: string) => map.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      map.delete(key);
    }),
  };
  return { map, backend };
}

describe("chunked SecureStore adapter", () => {
  it("stores and reads small values in a single key", async () => {
    const { map, backend } = makeMemoryBackend();
    const storage = createChunkedSecureStorage(backend);

    await storage.setItem("small.token", "abc-123");
    expect(await storage.getItem("small.token")).toBe("abc-123");
    expect(map.has("small.token.__chunks")).toBe(false);
  });

  it("chunks payloads larger than 1600 bytes and reassembles cleanly", async () => {
    const { map, backend } = makeMemoryBackend();
    const storage = createChunkedSecureStorage(backend);

    const payload = JSON.stringify({
      access_token: "a".repeat(2100),
      refresh_token: "r".repeat(1900),
      user: { id: "u-1" },
    });
    expect(payload.length).toBeGreaterThan(3200);

    await storage.setItem("sb:auth/session@1", payload);
    expect(await storage.getItem("sb:auth/session@1")).toBe(payload);

    // Every stored key respects SecureStore allowed characters.
    for (const key of map.keys()) {
      expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
    }
    expect(Number(map.get("sb_auth_session_1.__chunks"))).toBeGreaterThanOrEqual(3);
  });

  it("cleans up obsolete trailing chunks when shrinking a value", async () => {
    const { map, backend } = makeMemoryBackend();
    const storage = createChunkedSecureStorage(backend);

    await storage.setItem("session", "x".repeat(4000));
    expect(map.has("session.__c2")).toBe(true);

    // Shrink to 2 chunks, then down to single key
    await storage.setItem("session", "y".repeat(2000));
    expect(map.has("session.__c2")).toBe(false);
    expect(await storage.getItem("session")).toBe("y".repeat(2000));

    await storage.setItem("session", "tiny");
    expect(map.has("session.__chunks")).toBe(false);
    expect(map.has("session.__c0")).toBe(false);
    expect(map.has("session.__c1")).toBe(false);
    expect(await storage.getItem("session")).toBe("tiny");
  });

  it("removes all chunks and metadata on removeItem", async () => {
    const { map, backend } = makeMemoryBackend();
    const storage = createChunkedSecureStorage(backend);

    await storage.setItem("session", "z".repeat(3800));
    expect(map.size).toBeGreaterThan(2);

    await storage.removeItem("session");
    expect(map.size).toBe(0);
    expect(await storage.getItem("session")).toBeNull();
  });
});
