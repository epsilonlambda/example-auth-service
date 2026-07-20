import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBasicAuth } from "../src/app/auth/basic-auth.ts";

function header(userpass: string): string {
  return `Basic ${Buffer.from(userpass, "utf8").toString("base64")}`;
}

test("parses a standard username and password", () => {
  assert.deepEqual(parseBasicAuth(header("kirill:h7q9w2x8k3vn5pz")), {
    username: "kirill",
    password: "h7q9w2x8k3vn5pz",
  });
});

test("splits on the first colon so passwords may contain colons", () => {
  assert.deepEqual(parseBasicAuth(header("kirill:pa:ss:word")), {
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

test("allows an empty username", () => {
  assert.deepEqual(parseBasicAuth(header(":onlypassword")), {
    username: "",
    password: "onlypassword",
  });
});

test("returns null for a missing header", () => {
  assert.equal(parseBasicAuth(undefined), null);
});

test("returns null for a non-Basic scheme", () => {
  assert.equal(parseBasicAuth("Bearer abc123"), null);
});

test("returns null when the decoded credentials contain no colon", () => {
  assert.equal(parseBasicAuth(`Basic ${Buffer.from("nocolonhere").toString("base64")}`), null);
});
