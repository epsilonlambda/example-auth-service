// Password acceptance policy: NIST SP 800-63B-4 length floor plus a blocklist
// meaningful at that floor (structural predicates, context containment, and a
// corpus residual).

export const PASSWORD_MIN_CODE_POINTS = 15;
export const PASSWORD_MAX_CODE_POINTS = 512;
export const USERNAME_MIN_CODE_POINTS = 3;

export type PolicyCode =
  | "password_too_short"
  | "password_too_long"
  | "password_all_one_char"
  | "password_repeated_block"
  | "password_sequence"
  | "password_contains_username"
  | "password_contains_service_name"
  | "password_common"
  | "username_too_short";

export type PolicyResult =
  | { ok: true; normalized: string }
  | { ok: false; code: PolicyCode; message: string };

// Names under which this service could plausibly appear in a password.
const SERVICE_NAME_VARIANTS = [
  "example-auth-service",
  "example_auth_service",
  "exampleauthservice",
  "auth-service",
  "auth_service",
  "authservice",
];

// Tracks a whole-string walk can follow. Each is repeated far enough to cover
// the maximum password length, so cyclic walks ("890123...") are caught too;
// reversed variants are derived below.
const WALK_ALPHABETS = [
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];

// Residual blocklist: every entry >= 15 characters from the head of a
// canonical public corpus, lowercased and deduplicated. Provenance:
// SecLists Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt
// at commit c205c36a445bff37f8e58a9ec829105cd4975c58 (2025-05-08), filtered
// with `awk 'length($0) >= 15'` (72 raw lines, 70 unique lowercased).
const RESIDUAL_BLOCKLIST = new Set([
  "111111111111111",
  "11111111111111111111",
  "111222333444555",
  "1213141516171819",
  "122333444455555",
  "123123123123123",
  "123451234512345",
  "1234567812345678",
  "1234567887654321",
  "12345678900987654321",
  "12345678901234567890",
  "1234567890987654321",
  "1234567890qwerty",
  "1234567890qwertyuiop",
  "123456789101112",
  "123456789123456",
  "123456789123456789",
  "12345678987654321",
  "1234567899876543",
  "123456789987654321",
  "123456789qwerty",
  "12345678qwertyu",
  "1234qwerasdfzxcv",
  "1324354657687980",
  "1qa2ws3ed4rf5tg",
  "1qaz2wsx3edc4rfv",
  "1qazxsw23edcvfr4",
  "2222333344445555",
  "23176djivanfros",
  "277rte87hryloitru",
  "30secondstomars",
  "420842084208555",
  "aksjdlasdakj89879",
  "bhrh0h2oof6xbqjeh",
  "bpgjldsgjldthnf",
  "cfvfzcxfcnkbdfz",
  "cheaphornybastard",
  "efwe5tgwa5twhgd",
  "hd764nw5d7e1vb1",
  "hd764nw5d7e1vbv",
  "hjpjxrf23062007",
  "lhbjkjubz2957704",
  "lytdybrbdfvgbhf",
  "mailcreated5240",
  "manchesterunited",
  "momsanaladventure",
  "ne_e_pod_chehyl",
  "nemvxyheqdd5oqxyxyzi",
  "neversaymypassword",
  "nick1234-rem936",
  "passwordassword",
  "passwordpassword",
  "passwordstandard",
  "perasperaadastra",
  "perfectexploiter",
  "polniypizdec0211",
  "polniypizdec1102",
  "polniypizdec110211",
  "q1w2e3r4t5y6u7i8",
  "q1w2e3r4t5y6u7i8o9p0",
  "qazwsxedcrfvtgb",
  "qwertasdfgzxcvb",
  "qwerty123456789",
  "qwertyuiop12345",
  "qwertyuiop123456789",
  "qwertyuiopasdfg",
  "qwertyuiopasdfgh",
  "qwertyuiopasdfghjkl",
  "zqjphsyf6ctifgu",
  "zxcvbnm123456789",
]);

function codePointCount(s: string): number {
  let n = 0;
  for (const _ of s) {
    n += 1;
  }
  return n;
}

// A string equal to a shorter block repeated is periodic; the doubling trick
// finds any period smaller than the string itself.
function isRepeatedBlock(s: string): boolean {
  return (s + s).indexOf(s, 1) < s.length;
}

function isWholeStringWalk(s: string): boolean {
  for (const alphabet of WALK_ALPHABETS) {
    const track = alphabet.repeat(Math.ceil(PASSWORD_MAX_CODE_POINTS / alphabet.length) + 1);
    const reversed = [...track].reverse().join("");
    if (track.includes(s) || reversed.includes(s)) {
      return true;
    }
  }
  return false;
}

function rejection(code: PolicyCode, message: string): PolicyResult {
  return { ok: false, code, message };
}

// The single definition of the form that gets hashed: NFC so canonically
// equivalent inputs collapse to the same code points (D15). Registration and
// login both pass through here so the bytes measured are the bytes verified.
export function normalizePassword(password: string): string {
  return password.normalize("NFC");
}

// Checks run against the NFC-normalized password; the accepted result carries
// the normalized form so the same bytes are hashed that were measured here.
export function validatePassword(password: string, username: string): PolicyResult {
  if (codePointCount(normalizePassword(username)) < USERNAME_MIN_CODE_POINTS) {
    return rejection(
      "username_too_short",
      `username must be at least ${USERNAME_MIN_CODE_POINTS} characters`,
    );
  }

  const normalized = normalizePassword(password);
  const count = codePointCount(normalized);

  if (count < PASSWORD_MIN_CODE_POINTS) {
    return rejection(
      "password_too_short",
      `password must be at least ${PASSWORD_MIN_CODE_POINTS} characters, got ${count}`,
    );
  }
  if (count > PASSWORD_MAX_CODE_POINTS) {
    return rejection(
      "password_too_long",
      `password must be at most ${PASSWORD_MAX_CODE_POINTS} characters, got ${count}`,
    );
  }

  const lower = normalized.toLowerCase();

  if (/^(.)\1*$/su.test(lower)) {
    return rejection("password_all_one_char", "password is a single character repeated");
  }
  if (isRepeatedBlock(lower)) {
    return rejection("password_repeated_block", "password is a short block repeated");
  }
  if (isWholeStringWalk(lower)) {
    return rejection("password_sequence", "password is a character sequence or keyboard walk");
  }
  if (username !== "" && lower.includes(username.toLowerCase())) {
    return rejection("password_contains_username", "password must not contain the username");
  }
  for (const variant of SERVICE_NAME_VARIANTS) {
    if (lower.includes(variant)) {
      return rejection(
        "password_contains_service_name",
        "password must not contain the service name",
      );
    }
  }
  if (RESIDUAL_BLOCKLIST.has(lower)) {
    return rejection("password_common", "password is on the common-password blocklist");
  }

  return { ok: true, normalized };
}
