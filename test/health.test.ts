import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";

test("GET /health reports ok", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/health" });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok" });
});
