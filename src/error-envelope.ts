import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const FASTIFY_ERROR_CODES: Record<string, string> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: "unsupported_media_type",
  FST_ERR_CTP_BODY_TOO_LARGE: "payload_too_large",
};

function envelope(code: string, message: string) {
  return { error: { code, message } };
}

export function applyErrorEnvelope(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      // Internals never leak to callers: log the real error, send a fixed body.
      request.log.error({ err: error }, "request failed");
      return reply.status(statusCode).send(envelope("internal_error", "internal server error"));
    }

    const code = error.validation
      ? "validation_error"
      : (FASTIFY_ERROR_CODES[error.code] ?? "bad_request");
    return reply.status(statusCode).send(envelope(code, error.message));
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .status(404)
      .send(envelope("not_found", `${request.method} ${request.url} not found`));
  });
}
