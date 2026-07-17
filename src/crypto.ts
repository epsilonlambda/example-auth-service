import { argon2, randomBytes } from "node:crypto";
import { promisify } from "node:util";

// Argon2id at the OWASP baseline: m=19456 KiB, t=2, p=1, 16-byte salt, per
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
// The core API returns the raw tag; PHC formatting happens here so callers
// only ever see the storable string. No third-party code touches passwords.
const MEMORY_KIB = 19456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

// PHC strings carry base64 without padding.
function b64(buf: Buffer): string {
  return buf.toString("base64").replaceAll("=", "");
}

const argon2Async = promisify(argon2);

// Async on purpose: the hash runs on the libuv threadpool instead of
// blocking the event loop. There is deliberately no sync variant here.
export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(SALT_BYTES);
  const tag = await argon2Async("argon2id", {
    message: password,
    nonce,
    parallelism: PARALLELISM,
    tagLength: TAG_BYTES,
    memory: MEMORY_KIB,
    passes: PASSES,
  });
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${b64(nonce)}$${b64(tag)}`;
}

export type PasswordHasher = typeof hashPassword;
