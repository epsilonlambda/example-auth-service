import type { FastifyPluginAsyncJsonSchemaToTs } from "@fastify/type-provider-json-schema-to-ts";
import fp from "fastify-plugin";
import { AppError, makeErrorEnvelope } from "#app/error-envelope.ts";
import { challenge, parseBasicAuth } from "./basic-auth.ts";
import { hashPassword, verifyPassword } from "./crypto.ts";
import {
  normalizePassword,
  PASSWORD_MAX_CODE_POINTS,
  USERNAME_MIN_CODE_POINTS,
  validatePassword,
} from "./password-policy.ts";
import { registerAttempt, resetFailures } from "./throttle.ts";

// Lowercase subset of the POSIX portable-username charset, first character
// alphanumeric, 3-32 chars. Doubles as Redis key-injection defense: the
// username goes into the key verbatim.
const USERNAME_PATTERN = `^[a-z0-9][a-z0-9._-]{${USERNAME_MIN_CODE_POINTS - 1},31}$`;

const createUserBodySchema = {
  type: "object",
  required: ["username", "password"],
  additionalProperties: false,
  properties: {
    username: {
      type: "string",
      minLength: USERNAME_MIN_CODE_POINTS,
      maxLength: 32,
      pattern: USERNAME_PATTERN,
    },
    password: { type: "string", maxLength: PASSWORD_MAX_CODE_POINTS },
  },
} as const;

const principalResponseSchema = {
  type: "object",
  required: ["username"],
  additionalProperties: false,
  properties: {
    username: { type: "string" },
  },
} as const;

const errorResponseSchema = {
  type: "object",
  required: ["error"],
  additionalProperties: false,
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      additionalProperties: false,
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const;

const authenticateParamsSchema = {
  type: "object",
  required: ["username"],
  additionalProperties: false,
  properties: {
    username: { type: "string" },
  },
} as const;

const authRoutes: FastifyPluginAsyncJsonSchemaToTs = async (app) => {
  app.post(
    "/api/v1/users",
    {
      schema: {
        body: createUserBodySchema,
        response: { 201: principalResponseSchema },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;

      const verdict = validatePassword(password, username);
      if (!verdict.ok) {
        throw new AppError(400, verdict.code, verdict.message);
      }

      const passwordHash = await hashPassword(verdict.normalized);
      const created = await app.dataStore.set(
        `user:${username}`,
        JSON.stringify({ passwordHash }),
        "insert",
      );
      if (!created) {
        throw new AppError(409, "username_taken", "username is already taken");
      }

      return reply.status(201).header("location", `/api/v1/users/${username}`).send({ username });
    },
  );

  app.get(
    "/api/v1/users/:username",
    {
      schema: {
        params: authenticateParamsSchema,
        response: {
          200: principalResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
      onSend: async (_request, reply, payload) => {
        reply.header("cache-control", "no-store");
        reply.header("pragma", "no-cache");
        return payload;
      },
    },
    async (request, reply) => {
      const { username } = request.params;

      const credentials = parseBasicAuth(request.headers.authorization);
      if (credentials === null) {
        return challenge(reply, "unauthorized", "authentication required");
      }

      if (credentials.username !== username) {
        return reply
          .status(400)
          .send(
            makeErrorEnvelope("username_mismatch", "credentials do not match the requested user"),
          );
      }

      const retryAfter = await registerAttempt(app.dataStore, username);
      if (retryAfter !== null) {
        return reply
          .status(429)
          .header("retry-after", String(retryAfter))
          .send(makeErrorEnvelope("rate_limited", "too many failed attempts, try again later"));
      }

      const normalizedPassword = normalizePassword(credentials.password);

      const storedUserData = await app.dataStore.get(`user:${username}`);
      if (!storedUserData) {
        // Mitigate user enumeration via a timing-attack - perform same amount of work on auth attempts
        // for users that don't exist
        await hashPassword(normalizedPassword);
      } else {
        const storedHash = (JSON.parse(storedUserData) as { passwordHash: string }).passwordHash;
        const isPasswordVerified = await verifyPassword(storedHash, normalizedPassword);

        if (isPasswordVerified) {
          await resetFailures(app.dataStore, username);
          return reply.status(200).send({ username });
        }
      }

      return challenge(reply, "invalid_credentials", "invalid credentials");
    },
  );
};

// Encapsulated feature plugin that declares its dependency on the data store:
// Fastify throws at boot if `dataStore` is not decorated before this registers.
export const authPlugin = fp(authRoutes, {
  name: "auth",
  encapsulate: true,
  decorators: { fastify: ["dataStore"] },
});
