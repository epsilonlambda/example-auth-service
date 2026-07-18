import { type Argon2Algorithm, argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Argon2id at the OWASP baseline: m=19456 KiB, t=2, p=1, 16-byte salt, per
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
// The core API returns the raw tag; PHC formatting happens here so callers
// only ever see the storable string. No third-party code touches passwords.
const ARGON_ALGORITHM_NAME: Argon2Algorithm = "argon2id";
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

export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(SALT_BYTES);
  const tag = await argon2Async(ARGON_ALGORITHM_NAME, {
    message: password,
    nonce,
    parallelism: PARALLELISM,
    tagLength: TAG_BYTES,
    memory: MEMORY_KIB,
    passes: PASSES,
  });
  return `$${ARGON_ALGORITHM_NAME}$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${b64(nonce)}$${b64(tag)}`;
}

interface HashParams {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
}

// Parameters are read back from the stored string rather than assumed, so a
// future parameter bump still verifies hashes written under the old cost.
function extractHashParameters(hashString: string): HashParams {
  const [empty, algorithm, version, paramSegment, saltB64, tagB64] = hashString.split("$");
  if (
    empty !== "" ||
    algorithm !== "argon2id" ||
    version !== "v=19" ||
    paramSegment === undefined ||
    saltB64 === undefined ||
    tagB64 === undefined
  ) {
    throw new Error("stored password hash is not in the expected argon2id PHC format");
  }
  const [, memory, passes, parallelism] = paramSegment.match(/^m=(\d+),t=(\d+),p=(\d+)$/) ?? [];
  if (memory === undefined || passes === undefined || parallelism === undefined) {
    throw new Error("stored password hash has malformed argon2id parameters");
  }
  return {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    salt: Buffer.from(saltB64, "base64"),
    tag: Buffer.from(tagB64, "base64"),
  };
}

// Recomputes the tag under the stored salt and parameters, then compares in
// constant time so a match reveals nothing through timing.
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  const { memory, passes, parallelism, salt, tag } = extractHashParameters(storedHash);
  const recomputed = Buffer.from(
    await argon2Async(ARGON_ALGORITHM_NAME, {
      message: password,
      nonce: salt,
      parallelism,
      tagLength: tag.length,
      memory,
      passes,
    }),
  );
  return recomputed.length === tag.length && timingSafeEqual(recomputed, tag);
}
