import type { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import fastify, { type FastifyServerOptions } from "fastify";
import type { AppDeps } from "./deps.ts";
import { applyErrorEnvelope } from "./error-envelope.ts";
import { healthRoutes } from "./routes/health.ts";
import { usersRoutes } from "./routes/users.ts";

export function buildApp(opts: FastifyServerOptions, deps: AppDeps) {
  const app = fastify({
    ...opts,
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
