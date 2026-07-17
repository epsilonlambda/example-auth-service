import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
const app = buildApp({ logger: true });

function shutdown(signal: NodeJS.Signals): void {
  app.log.info({ signal }, "shutting down");
  void app.close().finally(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await app.listen({ host: "0.0.0.0", port });
