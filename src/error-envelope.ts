import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// Known framework 4xx rejections, mapped to canned bodies. 4xx messages
// reach callers only from this table, from Ajv (derived from the public
// schema), or from AppError (authored) - never from an arbitrary thrower's
// error.message, so a future dependency cannot leak through this handler.
const KNOWN_4XX: Record<string, { code: string; message: string }> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    code: "unsupported_media_type",
    message: "request content type must be application/json",
  },
  FST_ERR_CTP_BODY_TOO_LARGE: {
    code: "payload_too_large",
    message: "request body is too large",
  },
  FST_ERR_CTP_INVALID_JSON_BODY: {
    code: "bad_request",
    message: "request body must be valid JSON",
  },
  FST_ERR_CTP_EMPTY_JSON_BODY: {
    code: "bad_request",
    message: "request body must be valid JSON",
  },
};

// Deliberate domain errors thrown by route handlers. Their status, code, and
// message are authored constants, so the envelope emits them verbatim - the
// 5xx sanitization below only guards *unexpected* errors.
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function makeErrorEnvelope(code: string, message: string) {
  return { error: { code, message } };
}

export function applyErrorEnvelope(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(makeErrorEnvelope(error.code, error.message));
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      // Internals never leak to callers: log the real error, send a fixed body.
      request.log.error({ err: error }, "request failed");
      return reply
        .status(statusCode)
        .send(makeErrorEnvelope("internal_error", "internal server error"));
    }

    if (error.validation) {
      return reply.status(statusCode).send(makeErrorEnvelope("validation_error", error.message));
    }

    const known = KNOWN_4XX[error.code];
    if (known) {
      return reply.status(statusCode).send(makeErrorEnvelope(known.code, known.message));
    }

    // Unknown 4xx: keep the status, suppress the message we didn't author.
    request.log.warn({ err: error }, "unmapped 4xx error");
    return reply.status(statusCode).send(makeErrorEnvelope("bad_request", "bad request"));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .status(404)
      .send(makeErrorEnvelope("not_found", `${request.method} ${request.url} not found`));
  });
}
