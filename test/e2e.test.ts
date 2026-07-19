import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// E2E smoke against a running instance (docker compose up) over real HTTP.
// Gated so plain `npm test` needs no Docker; `npm run test:e2e` arms it.
// Only node built-ins here: the CI compose job runs this without `npm ci`.
const baseUrl = process.env.E2E_BASE_URL;
const skip = baseUrl ? false : "E2E_BASE_URL not set";

// Unique per run, so the persistent volume never turns a rerun into a 409.
const username = `e2e-${randomUUID().slice(0, 8)}`;
const password = "sturdy-passphrase-9x7q2m4";
const challenge = 'Basic realm="auth", charset="UTF-8"';

function createUser(body: unknown) {
  return fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

test("GET /health responds ok over real HTTP", { skip }, async () => {
  const res = await fetch(`${baseUrl}/health`);

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("golden path: register, reject duplicate, then authenticate", { skip }, async () => {
  const created = await createUser({ username, password });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { username });
  assert.equal(created.headers.get("location"), `/api/v1/users/${username}`);

  const duplicate = await createUser({ username, password });
  assert.equal(duplicate.status, 409);
  const body = (await duplicate.json()) as { error: { code: string } };
  assert.equal(body.error.code, "username_taken");

  const ok = await fetch(`${baseUrl}/api/v1/users/${username}`, {
    headers: { authorization: basicHeader(username, password) },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { username });
  assert.equal(ok.headers.get("cache-control"), "no-store");

  const wrong = await fetch(`${baseUrl}/api/v1/users/${username}`, {
    headers: { authorization: basicHeader(username, "totally-the-wrong-password") },
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("www-authenticate"), challenge);

  const noHeader = await fetch(`${baseUrl}/api/v1/users/${username}`);
  assert.equal(noHeader.status, 401);
  assert.equal(noHeader.headers.get("www-authenticate"), challenge);
});

test("weak password is rejected with its specific code", { skip }, async () => {
  const res = await createUser({ username: `e2e-${randomUUID().slice(0, 8)}`, password: "short" });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "password_too_short");
});

test("throttle: repeated wrong passwords return 429 + Retry-After", { skip }, async () => {
  const throttleUser = `e2e-${randomUUID().slice(0, 8)}`;
  const created = await createUser({ username: throttleUser, password });
  assert.equal(created.status, 201);

  // Bounded so a broken throttle fails the test instead of looping; the real
  // limit is well under this budget.
  let throttled: Response | undefined;
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${baseUrl}/api/v1/users/${throttleUser}`, {
      headers: { authorization: basicHeader(throttleUser, "wrong-password-guess") },
    });
    if (res.status === 429) {
      throttled = res;
      break;
    }
    assert.equal(res.status, 401, `attempt ${i} before the limit should be 401`);
  }

  assert.ok(throttled, "expected a 429 within the attempt budget");
  const retryAfter = Number(throttled.headers.get("retry-after"));
  assert.ok(Number.isInteger(retryAfter) && retryAfter > 0, "Retry-After is a positive integer");
  const body = (await throttled.json()) as { error: { code: string } };
  assert.equal(body.error.code, "rate_limited");
  assert.equal(throttled.headers.get("cache-control"), "no-store");
});
