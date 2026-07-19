import type { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import fastify, { type FastifyServerOptions } from "fastify";
import type { AppDeps } from "./deps.ts";
import { applyErrorEnvelope } from "./error-envelope.ts";
import { healthRoutes } from "./routes/health.ts";
import { usersRoutes } from "./routes/users.ts";

// A valid registration body tops out near 6 KiB (a 32-char ASCII username plus
// a 512-code-point password, worst case fully \u-escaped astral characters at
// ~12 bytes each); 16 KiB leaves margin while cutting Fastify's 1 MiB default
// body limit 64x, so oversized payloads are rejected before parsing.
const MAX_BODY_BYTES = 16 * 1024;

export function buildApp(opts: FastifyServerOptions, deps: AppDeps) {
  const app = fastify({
    ...opts,
    bodyLimit: MAX_BODY_BYTES,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
      },
    },
  });

  // JSON-only API: Fastify bundles a text/plain parser by default; removing
  // it makes every non-JSON content type fail negotiation with 415.
  app.removeContentTypeParser("text/plain");

  applyErrorEnvelope(app);

  const typed = app.withTypeProvider<JsonSchemaToTsProvider>();
  typed.register(usersRoutes, deps);
  typed.register(healthRoutes, { redis: deps.redis });

  return typed;
}
