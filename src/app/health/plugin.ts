import type { FastifyPluginAsyncJsonSchemaToTs } from "@fastify/type-provider-json-schema-to-ts";
import fp from "fastify-plugin";
import { AppError } from "../error-envelope.ts";

const healthResponseSchema = {
  type: "object",
  required: ["status"],
  additionalProperties: false,
  properties: {
    status: { type: "string" },
  },
} as const;

const healthRoutes: FastifyPluginAsyncJsonSchemaToTs = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    async (request) => {
      try {
        await app.dataStore.ping();
      } catch (err) {
        request.log.error({ err }, "health check ping failed");
        throw new AppError(503, "unhealthy", "dependency check failed");
      }
      return { status: "ok" };
    },
  );
};

// Encapsulated plugin that declares its dependency on the data store (it PINGs
// the store), enforced at boot by Fastify.
export const healthPlugin = fp(healthRoutes, {
  name: "health",
  encapsulate: true,
  decorators: { fastify: ["dataStore"] },
});
