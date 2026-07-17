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

function createUser(body: unknown) {
  return fetch(`${baseUrl}/api/v1/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("GET /health responds ok over real HTTP", { skip }, async () => {
  const res = await fetch(`${baseUrl}/health`);

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("registration golden path: 201 then 409 on the same username", { skip }, async () => {
  const created = await createUser({ username, password });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { username });
  assert.equal(created.headers.get("location"), `/api/v1/users/${username}`);

  const duplicate = await createUser({ username, password });
  assert.equal(duplicate.status, 409);
  const body = (await duplicate.json()) as { error: { code: string } };
  assert.equal(body.error.code, "username_taken");
});

test("weak password is rejected with its specific code", { skip }, async () => {
  const res = await createUser({ username: `e2e-${randomUUID().slice(0, 8)}`, password: "short" });

  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "password_too_short");
});
