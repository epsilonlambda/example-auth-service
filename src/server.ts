import { buildApp } from "./app.ts";
import { assertCryptoCapability } from "./boot-check.ts";
import { createRedisConnection } from "./redis.ts";

assertCryptoCapability();

const port = Number(process.env.PORT ?? 3000);
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const connection = createRedisConnection(redisUrl);
const app = buildApp({ logger: true }, { redis: connection.redis });

connection.onError((err) => app.log.error({ err }, "redis client error"));

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    await connection.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));

// Connect before listening: if the store is unreachable, fail fast instead
// of accepting traffic that can only error.
await connection.connect();
await app.listen({ host: "0.0.0.0", port });
