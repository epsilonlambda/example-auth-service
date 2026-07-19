import { createClient } from "redis";
import type { RedisLike } from "./deps.ts";

export interface RedisConnection {
  redis: RedisLike;
  connect(): Promise<void>;
  close(): Promise<void>;
  onError(handler: (err: Error) => void): void;
}

export function createRedisConnection(url: string): RedisConnection {
  const client = createClient({ url });

  return {
    redis: {
      set: (key, value, options) => client.set(key, value, options),
      get: (key) => client.get(key),
      ping: () => client.ping(),
      incrementCounter: async (key, windowSeconds) => {
        const [count, , ttl] = await client
          .multi()
          .incr(key)
          .expire(key, windowSeconds, "NX")
          .ttl(key)
          .exec();
        return { count: Number(count), ttl: Number(ttl) };
      },
      clearCounter: async (key) => {
        await client.del(key);
      },
    },
    async connect() {
      await client.connect();
    },
    async close() {
      await client.close();
    },
    // node-redis emits "error" on connection trouble and reconnects on its
    // own; without a listener the event would crash the process.
    onError(handler) {
      client.on("error", handler);
    },
  };
}
