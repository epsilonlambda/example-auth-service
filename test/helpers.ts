import type { FastifyServerOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import type { RedisLike } from "../src/deps.ts";

export interface SetCall {
  key: string;
  value: string;
  options: unknown;
}

// In-memory stand-in honoring SET-NX semantics, with call recording so tests
// can assert what reached the store (and what never did). incrementCounter bumps
// the count, fixes the window once (EXPIRE NX), and returns count + ttl.
export function makeFakeRedis() {
  const store = new Map<string, string>();
  const setCalls: SetCall[] = [];
  const getCalls: string[] = [];
  const throttleStore = new Map<string, number>();
  const throttleWindow = new Map<string, number>();
  const incrementCounterCalls: string[] = [];
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
    async get(key) {
      getCalls.push(key);
      return store.get(key) ?? null;
    },
    async ping() {
      if (pingError) {
        throw pingError;
      }
      return "PONG";
    },
    async incrementCounter(key, windowSeconds) {
      incrementCounterCalls.push(key);
      const count = (throttleStore.get(key) ?? 0) + 1;
      throttleStore.set(key, count);
      if (!throttleWindow.has(key)) {
        throttleWindow.set(key, windowSeconds);
      }
      return { count, ttl: throttleWindow.get(key) ?? 0 };
    },
    async clearCounter(key) {
      throttleStore.delete(key);
      throttleWindow.delete(key);
    },
  };

  return {
    redis,
    store,
    setCalls,
    getCalls,
    throttleStore,
    incrementCounterCalls,
    failPing(err: Error = new Error("connection refused")) {
      pingError = err;
    },
  };
}

// Real argon2 runs: the routes import crypto directly, so only Redis is faked.
export function buildTestApp(opts: FastifyServerOptions = {}) {
  const fakeRedis = makeFakeRedis();
  const app = buildApp(opts, { redis: fakeRedis.redis });
  return {
    app,
    store: fakeRedis.store,
    setCalls: fakeRedis.setCalls,
    getCalls: fakeRedis.getCalls,
    throttleStore: fakeRedis.throttleStore,
    incrementCounterCalls: fakeRedis.incrementCounterCalls,
    failPing: fakeRedis.failPing,
  };
}
