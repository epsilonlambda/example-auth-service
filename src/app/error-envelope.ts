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

// Fastify routes both unknown paths and method-mismatches to the not-found
// handler. To answer a method-mismatch with 405 + Allow we track the methods
// each route pattern serves and match the request path against them. The
// pattern -> regex covers our static and ":param" segments; a wildcard route
// (none today) would simply not match and fall through to 404.
function patternToRegex(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${source}$`);
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

  // onRoute fires for child-plugin routes too, since this runs on the root
  // before the route plugins register.
  const routes = new Map<string, { match: RegExp; methods: Set<string> }>();
  app.addHook("onRoute", (route) => {
    const entry = routes.get(route.url) ?? {
      match: patternToRegex(route.url),
      methods: new Set<string>(),
    };
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      entry.methods.add(method);
    }
    routes.set(route.url, entry);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const queryStart = request.url.indexOf("?");
    const pathname = queryStart === -1 ? request.url : request.url.slice(0, queryStart);
    const allowed = new Set<string>();
    for (const { match, methods } of routes.values()) {
      if (match.test(pathname)) {
        for (const method of methods) {
          allowed.add(method);
        }
      }
    }

    if (allowed.size > 0) {
      // The path exists under other methods: 405 with Allow, not 404.
      return reply
        .status(405)
        .header("allow", [...allowed].sort().join(", "))
        .send(makeErrorEnvelope("method_not_allowed", "method not allowed"));
    }

    return reply
      .status(404)
      .send(makeErrorEnvelope("not_found", `${request.method} ${request.url} not found`));
  });
}
