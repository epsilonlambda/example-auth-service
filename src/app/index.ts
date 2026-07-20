import type { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import fastify, { type FastifyServerOptions } from "fastify";
import { authPlugin } from "./auth/plugin.ts";
import { type DataStore, dataStorePlugin } from "./data-store/plugin.ts";
import { applyErrorEnvelope } from "./error-envelope.ts";
import { healthPlugin } from "./health/plugin.ts";

export type AppOptions = { fastifyOptions?: FastifyServerOptions } & (
  | { redisUrl: string }
  | { store: DataStore }
);

// A valid registration body tops out near 6 KiB (a 32-char ASCII username plus
// a 512-code-point password, worst case fully \u-escaped astral characters at
// ~12 bytes each); 16 KiB leaves margin while cutting Fastify's 1 MiB default
// body limit 64x, so oversized payloads are rejected before parsing.
const MAX_BODY_BYTES = 16 * 1024;

export function buildApp(options: AppOptions) {
  const app = fastify({
    ...options.fastifyOptions,
    bodyLimit: MAX_BODY_BYTES,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
      },
    },
  }).withTypeProvider<JsonSchemaToTsProvider>();

  // JSON-only API: Fastify bundles a text/plain parser by default; removing
  // it makes every non-JSON content type fail negotiation with 415.
  app.removeContentTypeParser("text/plain");

  applyErrorEnvelope(app);

  app.register(
    dataStorePlugin,
    "store" in options ? { store: options.store } : { redisUrl: options.redisUrl },
  );
  app.register(authPlugin);
  app.register(healthPlugin);

  return app;
}
