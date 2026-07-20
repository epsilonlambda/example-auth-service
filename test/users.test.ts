import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPassword } from "../src/crypto.ts";
import { buildTestApp } from "./helpers.ts";

type TestApp = ReturnType<typeof buildTestApp>["app"];

const GOOD_PASSWORD = "h7q9w2x8k3vn5pz";

function register(app: TestApp, payload: unknown) {
  return app.inject({ method: "POST", url: "/api/v1/users", payload: payload as object });
}

test("creates a user: 201, Location header, minimal body", async (t) => {
  const { app, store, setCalls } = buildTestApp();
  t.after(() => app.close());

  const res = await register(app, { username: "kirill", password: GOOD_PASSWORD });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json(), { username: "kirill" });
  assert.equal(res.headers.location, "/api/v1/users/kirill");

  assert.equal(setCalls.length, 1);
  const call = setCalls[0];
  assert.ok(call);
  assert.equal(call.key, "user:kirill");
  assert.equal(call.mode, "insert");
  const stored = JSON.parse(call.value) as { passwordHash: string };
  assert.match(stored.passwordHash, /^\$argon2id\$v=19\$/);
  assert.equal(await verifyPassword(stored.passwordHash, GOOD_PASSWORD), true);
  assert.equal(store.size, 1);
});

test("plaintext password never reaches the store", async (t) => {
  const { app, setCalls } = buildTestApp();
  t.after(() => app.close());

  await register(app, { username: "kirill", password: GOOD_PASSWORD });

  for (const call of setCalls) {
    assert.ok(!call.key.includes(GOOD_PASSWORD));
    assert.ok(!call.value.includes(GOOD_PASSWORD));
  }
});

test("duplicate username: 409 username_taken, store unchanged", async (t) => {
  const { app, store } = buildTestApp();
  t.after(() => app.close());

  const first = await register(app, { username: "kirill", password: GOOD_PASSWORD });
  assert.equal(first.statusCode, 201);

  const second = await register(app, { username: "kirill", password: `${GOOD_PASSWORD}2` });
  assert.equal(second.statusCode, 409);
  assert.deepEqual(second.json(), {
    error: { code: "username_taken", message: "username is already taken" },
  });
  assert.equal(store.size, 1);
});

test("username violations: 400 validation_error, nothing stored", async (t) => {
  const { app, setCalls } = buildTestApp();
  t.after(() => app.close());

  const badUsernames = [
    "ab", // below minimum
    "a".repeat(33), // above maximum
    "Kirill", // uppercase
    "-kirill", // leading hyphen
    ".kirill", // leading dot
    "kir!ll", // charset violation
    "kir ill", // whitespace
  ];

  for (const username of badUsernames) {
    const res = await register(app, { username, password: GOOD_PASSWORD });
    assert.equal(res.statusCode, 400, `expected 400 for username ${JSON.stringify(username)}`);
    assert.equal(res.json().error.code, "validation_error");
  }

  assert.deepEqual(setCalls, []);
});

test("policy rejections: specific codes, nothing stored", async (t) => {
  const { app, setCalls } = buildTestApp();
  t.after(() => app.close());

  const cases: Array<[string, string]> = [
    ["h7q9w2x8k3vn5p", "password_too_short"],
    ["aaaaaaaaaaaaaaa", "password_all_one_char"],
    ["xk7pxk7pxk7pxk7p", "password_repeated_block"],
    ["abcdefghijklmnop", "password_sequence"],
    ["greatkirillpassword", "password_contains_username"],
    ["greatauthservicepass", "password_contains_service_name"],
    ["manchesterunited", "password_common"],
  ];

  for (const [password, code] of cases) {
    const res = await register(app, { username: "kirill", password });
    assert.equal(res.statusCode, 400, `expected 400 for ${code}`);
    assert.equal(res.json().error.code, code);
  }

  assert.deepEqual(setCalls, []);
});

test("rejects unknown extra properties", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const res = await register(app, { username: "kirill", password: GOOD_PASSWORD, extra: "nope" });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "validation_error");
});

test("rejects malformed JSON", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    headers: { "content-type": "application/json" },
    payload: "{not json",
  });

  assert.equal(res.statusCode, 400);
});

test("rejects non-JSON content types with 415", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  for (const contentType of ["text/plain", "application/xml", ""]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { "content-type": contentType },
      payload: "whatever",
    });
    assert.equal(res.statusCode, 415, `expected 415 for ${JSON.stringify(contentType)}`);
  }
});
