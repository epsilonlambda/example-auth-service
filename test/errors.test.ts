import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";

test("unknown routes return the not_found envelope", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/nope" });

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), {
    error: { code: "not_found", message: "GET /nope not found" },
  });
});

test("validation failures return the validation_error envelope", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/echo", payload: {} });

  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.error.code, "validation_error");
  assert.equal(typeof body.error.message, "string");
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "message"]);
});

test("unsupported content types return the unsupported_media_type envelope", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "text/plain" },
    payload: "hello",
  });

  assert.equal(res.statusCode, 415);
  assert.equal(res.json().error.code, "unsupported_media_type");
});

test("handler failures return a sanitized internal_error envelope", async (t) => {
  const app = buildApp();
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
