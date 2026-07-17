import type { FastifyServerOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import type { RedisLike } from "../src/deps.ts";

export interface SetCall {
  key: string;
  value: string;
  options: unknown;
}

// In-memory stand-in honoring SET-NX semantics, with call recording so tests
// can assert what reached the store (and what never did).
export function makeFakeRedis() {
  const store = new Map<string, string>();
  const setCalls: SetCall[] = [];
  let pingError: Error | null = null;

  const redis: RedisLike = {
    async set(key, value, options) {
      setCalls.push({ key, value, options });
      if (store.has(key)) {
        return null;
      }
      store.set(key, value);
      return "OK";
    },
    async ping() {
      if (pingError) {
        throw pingError;
      }
      return "PONG";
    },
  };

  return {
    redis,
    store,
    setCalls,
    failPing(err: Error = new Error("connection refused")) {
      pingError = err;
    },
  };
}

// Deterministic, recognizable, and deliberately unrelated to its input so
// "plaintext never reaches the store" stays assertable.
export function makeFakeHasher() {
  const calls: string[] = [];
  async function hashPassword(password: string): Promise<string> {
    calls.push(password);
    return `$argon2id$fake$${calls.length}`;
  }
  return { hashPassword, hashCalls: calls };
}

export function buildTestApp(opts: FastifyServerOptions = {}) {
  const fakeRedis = makeFakeRedis();
  const fakeHasher = makeFakeHasher();
  const app = buildApp(opts, {
    redis: fakeRedis.redis,
    hashPassword: fakeHasher.hashPassword,
  });
  return {
    app,
    store: fakeRedis.store,
    setCalls: fakeRedis.setCalls,
    failPing: fakeRedis.failPing,
    hashCalls: fakeHasher.hashCalls,
  };
}
