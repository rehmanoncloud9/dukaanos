import "react-native-url-polyfill/auto";
import * as Crypto from "expo-crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

if (typeof globalThis.crypto !== "object" || !globalThis.crypto) {
  (globalThis as Record<string, unknown>).crypto = {};
}
if (typeof globalThis.crypto.getRandomValues !== "function") {
  (globalThis.crypto as { getRandomValues: typeof Crypto.getRandomValues }).getRandomValues =
    Crypto.getRandomValues.bind(Crypto);
}

ed.hashes.sha512 = sha512;
ed.hashes.sha512Async = (msg) => Promise.resolve(sha512(msg));

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

if (typeof globalThis.btoa !== "function") {
  globalThis.btoa = (input: string): string => {
    let out = "";
    for (let i = 0; i < input.length; i += 3) {
      const a = input.charCodeAt(i) & 0xff;
      const b = i + 1 < input.length ? input.charCodeAt(i + 1) & 0xff : 0;
      const c = i + 2 < input.length ? input.charCodeAt(i + 2) & 0xff : 0;
      const triplet = (a << 16) | (b << 8) | c;
      out += B64_CHARS[(triplet >> 18) & 0x3f];
      out += B64_CHARS[(triplet >> 12) & 0x3f];
      out += i + 1 < input.length ? B64_CHARS[(triplet >> 6) & 0x3f] : "=";
      out += i + 2 < input.length ? B64_CHARS[triplet & 0x3f] : "=";
    }
    return out;
  };
}

if (typeof globalThis.atob !== "function") {
  globalThis.atob = (input: string): string => {
    const clean = input.replace(/=+$/, "");
    let out = "";
    for (let i = 0; i < clean.length; i += 4) {
      const n1 = B64_CHARS.indexOf(clean[i]);
      const n2 = B64_CHARS.indexOf(clean[i + 1]);
      const n3 = i + 2 < clean.length ? B64_CHARS.indexOf(clean[i + 2]) : -1;
      const n4 = i + 3 < clean.length ? B64_CHARS.indexOf(clean[i + 3]) : -1;
      if (n1 < 0 || n2 < 0) break;
      const triplet = (n1 << 18) | (n2 << 12) | ((n3 < 0 ? 0 : n3) << 6) | (n4 < 0 ? 0 : n4);
      out += String.fromCharCode((triplet >> 16) & 0xff);
      if (n3 >= 0) out += String.fromCharCode((triplet >> 8) & 0xff);
      if (n4 >= 0) out += String.fromCharCode(triplet & 0xff);
    }
    return out;
  };
}
