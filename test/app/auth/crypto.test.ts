import assert from "node:assert/strict";
import { argon2 } from "node:crypto";
import { test } from "node:test";
import { promisify } from "node:util";
import { hashPassword, verifyPassword } from "#app/auth/crypto.ts";

const argon2Async = promisify(argon2);

// RFC 9106 section 5.3 Argon2id known-answer vector: confirms the primitive the
// adapter is built on matches the specification, parameter wiring included (D18).
test("argon2id matches the RFC 9106 test vector", async () => {
  const tag = await argon2Async("argon2id", {
    message: Buffer.alloc(32, 0x01),
    nonce: Buffer.alloc(16, 0x02),
    secret: Buffer.alloc(8, 0x03),
    associatedData: Buffer.alloc(12, 0x04),
    parallelism: 4,
    tagLength: 32,
    memory: 32,
    passes: 3,
  });

  assert.equal(
    Buffer.from(tag).toString("hex"),
    "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
  );
});

const PASSWORD = "correct horse battery staple";

test("hashPassword produces a verifiable argon2id PHC string", async () => {
  const hash = await hashPassword(PASSWORD);

  assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(await verifyPassword(hash, PASSWORD), true);
});

test("verifyPassword rejects the wrong password", async () => {
  const hash = await hashPassword(PASSWORD);

  assert.equal(await verifyPassword(hash, "correct horse battery stapl3"), false);
});

test("each hash carries a fresh salt yet both verify", async () => {
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);

  assert.notEqual(first, second);
  assert.equal(await verifyPassword(first, PASSWORD), true);
  assert.equal(await verifyPassword(second, PASSWORD), true);
});

test("hashes and verifies a non-ASCII password", async () => {
  const password = `pa${String.fromCodePoint(0x00e9)}ss${String.fromCodePoint(0x1f512)}`;
  const hash = await hashPassword(password);

  assert.equal(await verifyPassword(hash, password), true);
  assert.equal(await verifyPassword(hash, `${password}x`), false);
});

test("verifies a hash written under older, non-default parameters", async () => {
  // Build a PHC string at a lower cost than the current defaults (m=19456,t=2,p=1);
  // verify must recompute under the STORED params, not the current constants (D17).
  const salt = Buffer.alloc(16, 7);
  const b64 = (buf: Buffer) => buf.toString("base64").replaceAll("=", "");
  const oldTag = Buffer.from(
    await argon2Async("argon2id", {
      message: PASSWORD,
      nonce: salt,
      parallelism: 1,
      tagLength: 32,
      memory: 8,
      passes: 1,
    }),
  );
  const oldHash = `$argon2id$v=19$m=8,t=1,p=1$${b64(salt)}$${b64(oldTag)}`;

  assert.equal(await verifyPassword(oldHash, PASSWORD), true);
  assert.equal(await verifyPassword(oldHash, "wrong password entirely"), false);
});

test("throws on a malformed stored hash", async () => {
  const badFormat = [
    "not-a-hash", // too few "$" segments
    "$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$dGFn", // wrong algorithm
    "$argon2id$v=13$m=19456,t=2,p=1$c2FsdA$dGFn", // wrong version
    "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA", // missing the tag segment
  ];
  for (const stored of badFormat) {
    await assert.rejects(verifyPassword(stored, PASSWORD), /expected argon2id PHC format/);
  }

  await assert.rejects(
    verifyPassword("$argon2id$v=19$m=x,t=2,p=1$c2FsdA$dGFn", PASSWORD),
    /malformed argon2id parameters/,
  );
});
