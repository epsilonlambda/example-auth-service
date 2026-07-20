import { buildApp } from "./app.ts";
import { assertCryptoCapability } from "./boot-check.ts";

assertCryptoCapability();

const port = Number(process.env.PORT ?? 3000);
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const app = buildApp({ fastifyOptions: { logger: true }, redisUrl });

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));

await app.listen({ host: "0.0.0.0", port });
