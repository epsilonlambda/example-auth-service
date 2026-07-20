import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTestApp } from "#test/helpers.ts";

test("GET /health returns ok when the store answers PING", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/health" });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok" });
});

test("GET /health returns a sanitized 503 when PING fails", async (t) => {
  const { app, failPing } = buildTestApp();
  t.after(() => app.close());

  failPing(new Error("ECONNREFUSED 10.0.0.5:6379"));

  const res = await app.inject({ method: "GET", url: "/health" });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), {
    error: { code: "unhealthy", message: "dependency check failed" },
  });
  assert.ok(!res.body.includes("ECONNREFUSED"), "cause must not leak to callers");
});
