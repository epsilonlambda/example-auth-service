import type { FastifyPluginAsyncJsonSchemaToTs } from "@fastify/type-provider-json-schema-to-ts";
import type { RedisLike } from "../deps.ts";
import { AppError } from "../error-envelope.ts";

const healthResponseSchema = {
  type: "object",
  required: ["status"],
  additionalProperties: false,
  properties: {
    status: { type: "string" },
  },
} as const;

export const healthRoutes: FastifyPluginAsyncJsonSchemaToTs<{
  Options: { redis: RedisLike };
}> = async (app, { redis }) => {
  app.get(
    "/health",
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    async (request) => {
      try {
        await redis.ping();
      } catch (err) {
        request.log.error({ err }, "health check ping failed");
        throw new AppError(503, "unhealthy", "dependency check failed");
      }
      return { status: "ok" };
    },
  );
};
