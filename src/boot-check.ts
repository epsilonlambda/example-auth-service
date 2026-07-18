import { argon2 } from "node:crypto";

export function assertCryptoCapability(capability: unknown = argon2): void {
  // capability is a test seam: pass null to force the failure branch
  // (undefined would select the argon2 default).
  if (typeof capability !== "function") {
    throw new Error(
      "node:crypto argon2 is unavailable; this service requires Node >= 24.7 (see .nvmrc)",
    );
  }
}
