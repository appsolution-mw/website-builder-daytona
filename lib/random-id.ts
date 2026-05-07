/**
 * RFC 4122 v4 random id, safe in non-secure browser contexts (HTTP without
 * localhost). `globalThis.crypto.randomUUID` is gated to secure contexts only,
 * so we fall back to `crypto.getRandomValues`. Last resort uses `Math.random`,
 * which is fine for client-side request correlation ids.
 */
export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // fallthrough to getRandomValues path
    }
  }

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Per RFC 4122 §4.4: set version (4) and variant (10xx).
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = new Array(16);
  for (let i = 0; i < 16; i += 1) hex[i] = bytes[i].toString(16).padStart(2, "0");
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
    `${hex[4]}${hex[5]}-` +
    `${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-` +
    `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  );
}
