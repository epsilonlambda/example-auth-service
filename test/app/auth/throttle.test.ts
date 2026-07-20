import assert from "node:assert/strict";
import { test } from "node:test";
import { THROTTLE_MAX_FAILURES } from "#app/auth/throttle.ts";
import { buildTestApp } from "#test/helpers.ts";

type TestApp = ReturnType<typeof buildTestApp>["app"];

const USERNAME = "kirill";
const PASSWORD = "h7q9w2x8k3vn5pz";
const WRONG = "h7q9w2x8k3vn5pZ";

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

async function register(app: TestApp, username: string, password: string): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { username, password },
  });
  assert.equal(res.statusCode, 201, "precondition: user registered");
}

function authenticate(app: TestApp, username: string, auth?: string) {
  return app.inject({
    method: "GET",
    url: `/api/v1/users/${username}`,
    headers: auth ? { authorization: auth } : {},
  });
}

// Exhaust the allowance with wrong credentials, asserting each stays 401, then
// return the next response (the one the throttle should reject).
async function tripThrottle(app: TestApp, username: string, auth: string) {
  for (let i = 0; i < THROTTLE_MAX_FAILURES; i++) {
    const res = await authenticate(app, username, auth);
    assert.equal(res.statusCode, 401, `attempt ${i} should still be 401, before the limit`);
  }
  return authenticate(app, username, auth);
}

test("throttles after the configured failures: 429 rate_limited + Retry-After", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());
  await register(app, USERNAME, PASSWORD);

  const res = await tripThrottle(app, USERNAME, basic(USERNAME, WRONG));

  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.json(), {
    error: { code: "rate_limited", message: "too many failed attempts, try again later" },
  });
  const retryAfter = Number(res.headers["retry-after"]);
  assert.ok(Number.isInteger(retryAfter) && retryAfter > 0, "Retry-After is a positive integer");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["www-authenticate"], undefined);
});

test("once tripped, even a correct password is rejected (throttle precedes verify)", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());
  await register(app, USERNAME, PASSWORD);

  await tripThrottle(app, USERNAME, basic(USERNAME, WRONG));

  const res = await authenticate(app, USERNAME, basic(USERNAME, PASSWORD));
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, "rate_limited");
});

test("existence-blind: an unregistered username throttles identically", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const res = await tripThrottle(app, "ghost", basic("ghost", PASSWORD));
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, "rate_limited");
});

test("throttled existing-user and unknown-user 429s are byte-identical", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());
  await register(app, USERNAME, PASSWORD);

  const known = await tripThrottle(app, USERNAME, basic(USERNAME, WRONG));
  const ghost = await tripThrottle(app, "ghost", basic("ghost", PASSWORD));

  // The 429 is emitted before the user lookup, so it cannot betray existence:
  // body, Retry-After, and headers are indistinguishable between the two.
  assert.equal(known.statusCode, 429);
  assert.equal(ghost.statusCode, 429);
  assert.equal(known.body, ghost.body);
  assert.equal(known.headers["retry-after"], ghost.headers["retry-after"]);
  assert.equal(known.headers["cache-control"], ghost.headers["cache-control"]);
  assert.equal(known.headers["www-authenticate"], undefined);
  assert.equal(ghost.headers["www-authenticate"], undefined);
});

test("a successful login resets the counter", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());
  await register(app, USERNAME, PASSWORD);

  for (let i = 0; i < THROTTLE_MAX_FAILURES - 1; i++) {
    const res = await authenticate(app, USERNAME, basic(USERNAME, WRONG));
    assert.equal(res.statusCode, 401);
  }

  const ok = await authenticate(app, USERNAME, basic(USERNAME, PASSWORD));
  assert.equal(ok.statusCode, 200);

  // Reset means a full fresh allowance is needed to trip again.
  const res = await tripThrottle(app, USERNAME, basic(USERNAME, WRONG));
  assert.equal(res.statusCode, 429);
});

test("missing header and username mismatch never touch the throttle", async (t) => {
  const { app, incrementCounterCalls } = buildTestApp();
  t.after(() => app.close());
  await register(app, USERNAME, PASSWORD);

  const missing = await authenticate(app, USERNAME);
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.json().error.code, "unauthorized");

  const mismatch = await authenticate(app, USERNAME, basic("someone-else", PASSWORD));
  assert.equal(mismatch.statusCode, 400);
  assert.equal(mismatch.json().error.code, "username_mismatch");

  assert.deepEqual(incrementCounterCalls, []);
});
