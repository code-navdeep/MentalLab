// Secrets are encrypted before they touch the database. Electron's
// safeStorage (Keychain-backed) provides the implementation; main injects it
// at boot so the engine never imports electron directly.

export interface SecretStore {
  encrypt(plaintext: string): string; // returns an opaque storable token
  decrypt(token: string): string;
}

let store: SecretStore | null = null;

export function setSecretStore(s: SecretStore): void {
  store = s;
}

export function getSecretStore(): SecretStore {
  if (!store) {
    throw new Error("SecretStore not initialized — call setSecretStore first");
  }
  return store;
}
