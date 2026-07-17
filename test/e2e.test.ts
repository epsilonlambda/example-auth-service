import assert from "node:assert/strict";
import { test } from "node:test";

// E2E smoke against a running instance (docker compose up) over real HTTP.
// Gated so plain `npm test` needs no Docker; `npm run test:e2e` arms it.
const baseUrl = process.env.E2E_BASE_URL;
const skip = baseUrl ? false : "E2E_BASE_URL not set";

test("GET /health responds ok over real HTTP", { skip }, async () => {
  const res = await fetch(`${baseUrl}/health`);

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});
