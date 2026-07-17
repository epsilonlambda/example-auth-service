import type { FastifyPluginAsyncJsonSchemaToTs } from "@fastify/type-provider-json-schema-to-ts";

const echoBodySchema = {
  type: "object",
  required: ["message"],
  additionalProperties: false,
  properties: {
    message: { type: "string", maxLength: 4096 },
  },
} as const;

const echoResponseSchema = {
  type: "object",
  required: ["message", "timestamp"],
  additionalProperties: false,
  properties: {
    message: { type: "string" },
    timestamp: { type: "string" },
  },
} as const;

// Temporary scaffold-verification endpoint: exercises schema validation,
// serialization, and the test harness end to end. Removed when the real
// API routes land.
export const echoRoutes: FastifyPluginAsyncJsonSchemaToTs = async (app) => {
  app.post(
    "/echo",
    {
      schema: {
        body: echoBodySchema,
        response: { 200: echoResponseSchema },
      },
    },
    async (request) => ({
      message: request.body.message,
      timestamp: new Date().toISOString(),
    }),
  );
};
