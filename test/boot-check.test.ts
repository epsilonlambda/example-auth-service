import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCryptoCapability } from "../src/boot-check.ts";

test("passes on a runtime with argon2 available", () => {
  assert.doesNotThrow(() => assertCryptoCapability());
});

// null, not undefined: undefined would select the real-argon2 default.
test("throws a clear message when the capability is absent", () => {
  assert.throws(() => assertCryptoCapability(null), /Node >= 24\.7/);
});
