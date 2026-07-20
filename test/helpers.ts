import type { FastifyServerOptions } from "fastify";
import { buildApp } from "../src/app.ts";
import type { DataStore } from "../src/data-store/plugin.ts";

export interface SetCall {
  key: string;
  value: string;
  mode: "insert" | "upsert";
}

// In-memory stand-in honoring SET-NX semantics, with call recording so tests
// can assert what reached the store (and what never did). incrementCounter bumps
// the count, fixes the window once (EXPIRE NX), and returns count + ttl.
export function makeFakeDataStore() {
  const store = new Map<string, string>();
  const setCalls: SetCall[] = [];
  const getCalls: string[] = [];
  const throttleStore = new Map<string, number>();
  const throttleWindow = new Map<string, number>();
  const incrementCounterCalls: string[] = [];
  let pingError: Error | null = null;

  const dataStore: DataStore = {
    async set(key, value, mode) {
      setCalls.push({ key, value, mode });
      if (mode === "insert" && store.has(key)) {
        return false;
      }
      store.set(key, value);
      return true;
    },
    async get(key) {
      getCalls.push(key);
      return store.get(key) ?? null;
    },
    async ping() {
      if (pingError) {
        throw pingError;
      }
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
    dataStore,
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

// Real argon2 runs: the routes import crypto directly, so only the store is faked.
export function buildTestApp(opts: FastifyServerOptions = {}) {
  const fakeStore = makeFakeDataStore();
  const app = buildApp({ fastifyOptions: opts, store: fakeStore.dataStore });
  return {
    app,
    store: fakeStore.store,
    setCalls: fakeStore.setCalls,
    getCalls: fakeStore.getCalls,
    throttleStore: fakeStore.throttleStore,
    incrementCounterCalls: fakeStore.incrementCounterCalls,
    failPing: fakeStore.failPing,
  };
}
