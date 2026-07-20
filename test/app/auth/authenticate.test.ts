import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { buildTestApp } from "#test/helpers.ts";

type TestApp = ReturnType<typeof buildTestApp>["app"];

const USERNAME = "kirill";
const PASSWORD = "h7q9w2x8k3vn5pz";
const CHALLENGE = 'Basic realm="auth", charset="UTF-8"';
const INVALID_CREDENTIALS = {
  error: { code: "invalid_credentials", message: "invalid credentials" },
};

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

test("authenticates a registered user: 200, principal body, no-store", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());
  await register(app, USERNAME, PASSWORD);

  const res = await authenticate(app, USERNAME, basic(USERNAME, PASSWORD));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { username: USERNAME });
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers.pragma, "no-cache");
  assert.equal(res.headers["www-authenticate"], undefined);
});

test("wrong password and unknown user are byte-identical 401s", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());
  await register(app, USERNAME, PASSWORD);

  const wrong = await authenticate(app, USERNAME, basic(USERNAME, "h7q9w2x8k3vn5pZ"));
  const unknown = await authenticate(app, "ghost", basic("ghost", PASSWORD));

  for (const res of [wrong, unknown]) {
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), INVALID_CREDENTIALS);
    assert.equal(res.headers["www-authenticate"], CHALLENGE);
    assert.equal(res.headers["cache-control"], "no-store");
  }
  // The content channel is closed: the two responses are indistinguishable.
  assert.equal(wrong.body, unknown.body);
});

test("missing Authorization: 401 unauthorized, no store read", async (t) => {
  const { app, getCalls } = buildTestApp();
  t.after(() => app.close());

  const res = await authenticate(app, USERNAME);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), {
    error: { code: "unauthorized", message: "authentication required" },
  });
  assert.equal(res.headers["www-authenticate"], CHALLENGE);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(getCalls, []);
});

test("username mismatch: 400 before any store I/O", async (t) => {
  const { app, getCalls } = buildTestApp();
  t.after(() => app.close());

  const res = await authenticate(app, USERNAME, basic("someone-else", PASSWORD));

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), {
    error: { code: "username_mismatch", message: "credentials do not match the requested user" },
  });
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["www-authenticate"], undefined);
  assert.deepEqual(getCalls, []);
});

test("login does not re-run the password policy: a weak password gets 401, not 400", async (t) => {
  const { app } = buildTestApp();
  t.after(() => app.close());
  await register(app, USERNAME, PASSWORD);

  const res = await authenticate(app, USERNAME, basic(USERNAME, "short"));

  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, "invalid_credentials");
});

// Black-box guard for the anti-enumeration property (D20): the unknown-user
// path must spend the same argon2 work as a wrong password, so account presence
// cannot be timed. Absolute times differ per machine, so we compare the two
// paths to each other; a correct impl gives ratio ~1.0, a skipped unknown-user
// hash would return in ~1ms and crater it. Robustness: interleave (shared load
// cancels), reduce with min (noise only adds time), a lenient floor (the honest
// gap is ~25x), and retry. It never skips - green here means the check ran.
const SAMPLES = 6;
const RETRIES = 3;
const MIN_RATIO = 0.5;

test("unknown-user path spends the same work as wrong-password (no timing oracle)", async (t) => {
  const { app, throttleStore } = buildTestApp();
  t.after(() => app.close());
  await register(app, USERNAME, PASSWORD);

  async function timeAuth(username: string, auth: string): Promise<number> {
    const start = performance.now();
    await authenticate(app, username, auth);
    return performance.now() - start;
  }

  async function measureRatio(): Promise<number> {
    // Reset the failure counter each sample so the throttle never trips
    // mid-measurement: this test times per-attempt work, not the throttle.
    throttleStore.clear();
    await timeAuth(USERNAME, basic(USERNAME, "warmup-wrong")); // warmup
    await timeAuth("ghost-warmup", basic("ghost-warmup", PASSWORD));

    const wrong: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      throttleStore.clear();
      wrong.push(await timeAuth(USERNAME, basic(USERNAME, `wrong-${i}`)));
      unknown.push(await timeAuth(`ghost-${i}`, basic(`ghost-${i}`, PASSWORD)));
    }
    return Math.min(...unknown) / Math.min(...wrong);
  }

  let ratio = 0;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    ratio = await measureRatio();
    if (ratio >= MIN_RATIO) break;
  }

  assert.ok(
    ratio >= MIN_RATIO,
    `unknown-user path is ${ratio.toFixed(2)}x the wrong-password cost (expected ~1.0); the unknown-user hash may be skipped`,
  );
});
