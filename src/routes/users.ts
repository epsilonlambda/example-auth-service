import type { FastifyPluginAsyncJsonSchemaToTs } from "@fastify/type-provider-json-schema-to-ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../error-envelope.ts";
import { checkPassword, PASSWORD_MAX_CODE_POINTS } from "../password-policy.ts";

// Lowercase subset of the POSIX portable-username charset, first character
// alphanumeric, 3-32 chars. Doubles as Redis key-injection defense: the
// username goes into the key verbatim.
const USERNAME_PATTERN = "^[a-z0-9][a-z0-9._-]{2,31}$";

const createUserBodySchema = {
  type: "object",
  required: ["username", "password"],
  additionalProperties: false,
  properties: {
    username: {
      type: "string",
      minLength: 3,
      maxLength: 32,
      pattern: USERNAME_PATTERN,
    },
    password: { type: "string", maxLength: PASSWORD_MAX_CODE_POINTS },
  },
} as const;

const createdResponseSchema = {
  type: "object",
  required: ["username"],
  additionalProperties: false,
  properties: {
    username: { type: "string" },
  },
} as const;

export const usersRoutes: FastifyPluginAsyncJsonSchemaToTs<{ Options: AppDeps }> = async (
  app,
  { redis, hashPassword },
) => {
  app.post(
    "/api/v1/users",
    {
      schema: {
        body: createUserBodySchema,
        response: { 201: createdResponseSchema },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;

      const verdict = checkPassword(password, username);
      if (!verdict.ok) {
        throw new AppError(400, verdict.code, verdict.message);
      }

      const passwordHash = await hashPassword(verdict.normalized);
      const created = await redis.set(`user:${username}`, JSON.stringify({ passwordHash }), {
        condition: "NX",
      });
      if (created === null) {
        throw new AppError(409, "username_taken", "username is already taken");
      }

      return reply.status(201).header("location", `/api/v1/users/${username}`).send({ username });
    },
  );
};
