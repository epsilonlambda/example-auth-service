import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBasicAuth } from "#app/auth/basic-auth.ts";

function makeBasicAuthHeader(userpass: string): string {
  return `Basic ${Buffer.from(userpass, "utf8").toString("base64")}`;
}

test("parses a standard username and password", () => {
  assert.deepEqual(parseBasicAuth(makeBasicAuthHeader("kirill:h7q9w2x8k3vn5pz")), {
    username: "kirill",
    password: "h7q9w2x8k3vn5pz",
  });
});

test("splits on the first colon so passwords may contain colons", () => {
  assert.deepEqual(parseBasicAuth(makeBasicAuthHeader("kirill:pa:ss:word")), {
    username: "kirill",
    password: "pa:ss:word",
  });
});

test("accepts a case-insensitive scheme", () => {
  assert.deepEqual(parseBasicAuth(`basic ${Buffer.from("kirill:secret").toString("base64")}`), {
    username: "kirill",
    password: "secret",
  });
});

test("decodes UTF-8 credentials (composed accent + astral code point)", () => {
  const password = `p${String.fromCodePoint(0x00e9)}ss${String.fromCodePoint(0x1f512)}`;
  assert.deepEqual(parseBasicAuth(makeBasicAuthHeader(`kirill:${password}`)), {
    username: "kirill",
    password,
  });
});

test("rejects incomplete credentials: empty username, empty password, or both", () => {
  assert.equal(parseBasicAuth(makeBasicAuthHeader(":onlypassword")), null);
  assert.equal(parseBasicAuth(makeBasicAuthHeader("onlyusername:")), null);
  assert.equal(parseBasicAuth(makeBasicAuthHeader(":")), null);
});

test("returns null for a missing header", () => {
  assert.equal(parseBasicAuth(undefined), null);
});

test("returns null for an empty or all-whitespace header", () => {
  assert.equal(parseBasicAuth(""), null);
  assert.equal(parseBasicAuth("   "), null);
});

test("returns null for a non-Basic scheme", () => {
  assert.equal(parseBasicAuth("Bearer abc123"), null);
});

test("returns null when the scheme carries no token", () => {
  assert.equal(parseBasicAuth("Basic"), null);
  assert.equal(parseBasicAuth("Basic "), null);
});

test("returns null when the decoded credentials contain no colon", () => {
  assert.equal(parseBasicAuth(`Basic ${Buffer.from("nocolonhere").toString("base64")}`), null);
});

test("returns null (without throwing) for malformed base64", () => {
  assert.equal(parseBasicAuth("Basic @@@@"), null);
});
