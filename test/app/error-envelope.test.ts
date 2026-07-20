import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTestApp } from "#test/helpers.ts";

test("unknown routes return the not_found envelope", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/nope" });

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), {
    error: { code: "not_found", message: "GET /nope not found" },
  });
});

test("validation failures return the validation_error envelope", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/api/v1/users", payload: {} });

  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error.code, "validation_error");
  assert.equal(typeof body.error.message, "string");
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "message"]);
});

test("unsupported content types return the unsupported_media_type envelope", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    headers: { "content-type": "text/plain" },
    payload: "hello",
  });

  assert.equal(res.statusCode, 415);
  assert.deepEqual(res.json(), {
    error: {
      code: "unsupported_media_type",
      message: "request content type must be application/json",
    },
  });
});

test("malformed JSON returns the canned bad_request envelope", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    headers: { "content-type": "application/json" },
    payload: '{"marker": INJECTED-CLIENT-BYTES',
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), {
    error: { code: "bad_request", message: "request body must be valid JSON" },
  });
  assert.ok(!res.body.includes("INJECTED"), "client bytes must not be reflected");
});

test("unknown 4xx errors keep their status but get a suppressed message", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  app.get("/teapot", async () => {
    const err = new Error("internal detail from an unmapped thrower") as Error & {
      statusCode: number;
    };
    err.statusCode = 418;
    throw err;
  });

  const res = await app.inject({ method: "GET", url: "/teapot" });

  assert.equal(res.statusCode, 418);
  assert.deepEqual(res.json(), {
    error: { code: "bad_request", message: "bad request" },
  });
  assert.ok(!res.body.includes("internal detail"), "unmapped messages must never be forwarded");
});

test("handler failures return a sanitized internal_error envelope", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  app.get("/boom", async () => {
    throw new Error("secret internal detail");
  });

  const res = await app.inject({ method: "GET", url: "/boom" });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), {
    error: { code: "internal_error", message: "internal server error" },
  });
  assert.ok(!res.body.includes("secret"), "internal error details must never reach the response");
});

test("wrong method on a known path returns 405 with an Allow header", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const cases: Array<{ method: "GET" | "POST" | "DELETE"; url: string; allow: string }> = [
    { method: "GET", url: "/api/v1/users", allow: "POST" },
    { method: "POST", url: "/api/v1/users/kirill", allow: "GET, HEAD" },
    { method: "DELETE", url: "/health", allow: "GET, HEAD" },
  ];

  for (const { method, url, allow } of cases) {
    const res = await app.inject({ method, url });
    assert.equal(res.statusCode, 405, `${method} ${url}`);
    assert.equal(res.headers.allow, allow, `${method} ${url} Allow`);
    assert.deepEqual(res.json(), {
      error: { code: "method_not_allowed", message: "method not allowed" },
    });
  }
});

test("unknown paths still return 404, not 405", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  for (const url of ["/api/v1/nope", "/api/v1/users/kirill/extra"]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 404, url);
    assert.equal(res.json().error.code, "not_found", url);
  }
});

test("oversize request bodies return the payload_too_large envelope", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());

  const payload = JSON.stringify({ username: "kirill", password: "x".repeat(20 * 1024) });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/users",
    headers: { "content-type": "application/json" },
    payload,
  });

  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.json(), {
    error: { code: "payload_too_large", message: "request body is too large" },
  });
});
