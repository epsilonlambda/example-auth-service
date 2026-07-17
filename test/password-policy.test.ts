import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPassword } from "../src/password-policy.ts";

const USERNAME = "kirill";

// Built from code points, never literal accented characters: the tests are
// about composition, so the source must be unambiguous about which form it
// holds (editors and tooling can silently renormalize literals).
const COMPOSED_E_ACUTE = String.fromCodePoint(0x00e9);
const DECOMPOSED_E_ACUTE = String.fromCodePoint(0x0065, 0x0301);

function expectRejection(password: string, code: string, username = USERNAME) {
  const result = checkPassword(password, username);
  assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(password)}`);
  if (!result.ok) {
    assert.equal(result.code, code);
    assert.ok(result.message.length > 0);
  }
}

test("accepts a strong password and returns the normalized form", () => {
  const result = checkPassword("h7q9w2x8k3vn5pz", USERNAME);
  assert.deepEqual(result, { ok: true, normalized: "h7q9w2x8k3vn5pz" });
});

test("rejects 14 code points, accepts 15 (boundary)", () => {
  expectRejection("h7q9w2x8k3vn5p", "password_too_short");
  assert.equal(checkPassword("h7q9w2x8k3vn5pz", USERNAME).ok, true);
});

test("rejects passwords above the maximum", () => {
  expectRejection(`x7${"9gk2m4p8r3t6w".repeat(40)}`, "password_too_long");
});

test("counts code points after NFC normalization, not raw units", () => {
  // Eight decomposed pairs: 6 + 16 = 22 raw code points, but 6 + 8 = 14 once
  // NFC composes them - the floor is measured post-NFC, so this is too short.
  expectRejection(`xk9wqz${DECOMPOSED_E_ACUTE.repeat(8)}`, "password_too_short");
  // 14 plain chars + 1 decomposed pair = exactly 15 post-NFC.
  const result = checkPassword(`h7q9w2x8k3vn5p${DECOMPOSED_E_ACUTE}`, USERNAME);
  assert.equal(result.ok, true);
});

test("accepted result carries the NFC-normalized form, not the input", () => {
  const decomposed = `h7q9w2x8k3vn5p${DECOMPOSED_E_ACUTE}`;
  const result = checkPassword(decomposed, USERNAME);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.normalized, `h7q9w2x8k3vn5p${COMPOSED_E_ACUTE}`);
    assert.notEqual(result.normalized, decomposed);
  }
});

test("rejects a single repeated character, case-insensitively", () => {
  expectRejection("aaaaaaaaaaaaaaa", "password_all_one_char");
  expectRejection("AAAAAAAAaaaaaaa", "password_all_one_char");
});

test("rejects a repeated block", () => {
  expectRejection("xk7pxk7pxk7pxk7p", "password_repeated_block");
});

test("all-one-char wins over repeated-block (precedence)", () => {
  expectRejection("bbbbbbbbbbbbbbbb", "password_all_one_char");
});

test("rejects whole-string sequences and keyboard walks", () => {
  expectRejection("abcdefghijklmnop", "password_sequence");
  expectRejection("zyxwvutsrqponmlk", "password_sequence");
  expectRejection("6789012345678901", "password_sequence");
  expectRejection("qwertyuiopqwerty", "password_sequence");
});

test("rejects passwords containing the username, case-insensitively", () => {
  expectRejection("myGoodKIRILLpass", "password_contains_username");
  expectRejection("kirill4layerpassword", "password_contains_username");
});

test("rejects passwords containing the service name", () => {
  expectRejection("xexample-auth-servicex", "password_contains_service_name");
  expectRejection("greatauthservicepass", "password_contains_service_name");
});

test("rejects residual-blocklist entries, case-insensitively", () => {
  expectRejection("manchesterunited", "password_common");
  expectRejection("ManchesterUnited", "password_common");
  expectRejection("perasperaadastra", "password_common");
});

test("near-miss of a blocklist entry passes the residual check", () => {
  const result = checkPassword("manchesterunited1", USERNAME);
  assert.equal(result.ok, true);
});
