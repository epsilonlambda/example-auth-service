import type { DataStore } from "#app/data-store/plugin.ts";

// Per-username login throttle (D23/D36/D47), NIST SP 800-63B-4 rate-limiting.
// registerAttempt increments and gates in one atomic step *before* hashing: the
// returned count is the exact gate, so a concurrent burst cannot slip past a
// read-only check and trigger unbounded argon2. Every attempt counts and a
// success resets (resetFailures) - "consecutive failures" by another name.
// Keyed by the attempted username regardless of existence, so a throttled
// response cannot enumerate accounts. Fixed window from the first attempt in a
// streak (EXPIRE NX sets the TTL once); Retry-After is the remaining TTL.
export const THROTTLE_MAX_FAILURES = 10;
export const THROTTLE_WINDOW_SECONDS = 900;

function throttleKey(username: string): string {
  return `throttle:${username}`;
}

// Counts this attempt and returns the Retry-After seconds if it is over the
// limit, else null to proceed.
export async function registerAttempt(store: DataStore, username: string): Promise<number | null> {
  const { count, ttl } = await store.incrementCounter(
    throttleKey(username),
    THROTTLE_WINDOW_SECONDS,
  );
  if (count > THROTTLE_MAX_FAILURES) {
    /**
     * Redis can return negative TTL values when a key doesn't exist/doesn't have expiry set.
     * This check protects a future refactor from returning those sentinel values as TTL used in Retry-After headers
     * See https://redis.io/docs/latest/commands/ttl/
     */
    return ttl > 0 ? ttl : THROTTLE_WINDOW_SECONDS;
  }
  return null;
}

export async function resetFailures(store: DataStore, username: string): Promise<void> {
  await store.clearCounter(throttleKey(username));
}
