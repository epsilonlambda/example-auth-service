import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.ts";

test("POST /echo echoes the message with a server timestamp", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/echo",
    payload: { message: "hello, world" },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.message, "hello, world");
  assert.ok(Number.isFinite(Date.parse(body.timestamp)), "timestamp must be ISO-8601 parseable");
});

test("POST /echo rejects a body without message", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: "POST", url: "/echo", payload: {} });

  assert.equal(res.statusCode, 400);
});

test("POST /echo rejects unknown extra properties", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/echo",
    payload: { message: "hi", extra: "nope" },
  });

  assert.equal(res.statusCode, 400);
});

test("POST /echo rejects malformed JSON", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/json" },
    payload: "{not json",
  });

  assert.equal(res.statusCode, 400);
});

test("POST /echo rejects text/plain content", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "text/plain" },
    payload: "hello",
  });

  assert.equal(res.statusCode, 415);
});

test("POST /echo rejects a body sent without a content type", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "" },
    payload: '{"message":"hi"}',
  });

  assert.equal(res.statusCode, 415);
});

test("POST /echo rejects unparseable content types", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/xml" },
    payload: "<message>hello</message>",
  });

  assert.equal(res.statusCode, 415);
});
