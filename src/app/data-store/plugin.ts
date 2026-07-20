import fp from "fastify-plugin";
import { createClient } from "redis";

// The narrow set of store operations the app depends on
export interface DataStore {
  // returns whether the write took effect (insert: false if key exists; upsert: always true)
  set(key: string, value: string, mode: "insert" | "upsert"): Promise<boolean>;
  get(key: string): Promise<string | null>;
  ping(): Promise<void>;
  incrementCounter(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }>;
  clearCounter(key: string): Promise<void>;
}

export type DataStorePluginOptions = { redisUrl: string } | { store: DataStore };

export const dataStorePlugin = fp<DataStorePluginOptions>(
  async (app, opts) => {
    if ("store" in opts) {
      app.decorate("dataStore", opts.store);
      return;
    }

    const client = createClient({ url: opts.redisUrl });
    // node-redis emits "error" on connection trouble and reconnects on its own;
    // without a listener the event would crash the process.
    client.on("error", (err) => app.log.error({ err }, "redis client error"));

    const dataStore: DataStore = {
      set: async (key, value, mode) => {
        if (mode === "insert") {
          return (await client.set(key, value, { condition: "NX" })) !== null;
        }
        await client.set(key, value);
        return true;
      },
      get: (key) => client.get(key),
      ping: async () => {
        await client.ping();
      },
      incrementCounter: async (key, windowSeconds) => {
        const [count, , ttl] = await client
          .multi()
          .incr(key)
           // Do not reset the window every time to prevent DoS on known users
          .expire(key, windowSeconds, "NX")
          .ttl(key)
          .exec();
        return { count: Number(count), ttl: Number(ttl) };
      },
      clearCounter: async (key) => {
        await client.del(key);
      },
    };

    app.decorate("dataStore", dataStore);
    app.addHook("onClose", async () => {
      await client.close();
    });

    await client.connect();
  },
  { name: "data-store" },
);
