import type { JsonSchemaToTsProvider } from "@fastify/type-provider-json-schema-to-ts";
import fastify, { type FastifyServerOptions } from "fastify";
import { applyErrorEnvelope } from "./error-envelope.ts";
import { echoRoutes } from "./routes/echo.ts";
import { healthRoutes } from "./routes/health.ts";

export function buildApp(opts: FastifyServerOptions = {}) {
  const app = fastify({
    ...opts,
    ajv: {
      customOptions: {
        // Fastify's Ajv defaults silently strip unknown body properties and
        // coerce types; a strict request contract must reject both.
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
  typed.register(echoRoutes);
  typed.register(healthRoutes);

  return typed;
}
