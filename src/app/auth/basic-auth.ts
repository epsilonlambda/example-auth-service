import type { FastifyReply } from "fastify";
import { makeErrorEnvelope } from "#app/error-envelope.ts";

export interface BasicCredentials {
  username: string;
  password: string;
}

// Request side: decode `Authorization: Basic <base64>` into credentials, or null.
export function parseBasicAuth(header: string | undefined): BasicCredentials | null {
  if (header === undefined) {
    return null;
  }
  const [, token] = header.match(/^basic\s+(\S+)\s*$/i) ?? [];
  if (token === undefined) {
    return null;
  }
  const decoded = Buffer.from(token, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon === -1) {
    return null;
  }
  const username = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  // A complete credential needs both halves: an empty username or password is
  // failing the contract (identifying without authenticating), same as no header.
  if (username === "" || password === "") {
    return null;
  }
  return { username, password };
}

// Response side: the Basic challenge (RFC 7617) - a 401 with WWW-Authenticate so
// the client knows to send Basic credentials, carrying the service error envelope.
const WWW_AUTHENTICATE = 'Basic realm="auth", charset="UTF-8"';

export function challenge(reply: FastifyReply, code: string, message: string) {
  return reply
    .status(401)
    .header("www-authenticate", WWW_AUTHENTICATE)
    .send(makeErrorEnvelope(code, message));
}
