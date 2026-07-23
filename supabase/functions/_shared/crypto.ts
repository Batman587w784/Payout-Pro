/**
 * Crypto helpers for Deno Edge Functions.
 *
 * Uses Web Crypto, not node:crypto. Every hash is async here because
 * crypto.subtle.digest returns a promise. That is the main porting difference
 * from a Node implementation.
 */

export const TOKEN_TTL_HOURS = 72;

/** Field order is fixed so the document hash is stable. */
export const FIELD_ORDER = [
  "business_name",
  "contact_person",
  "phone",
  "email",
  "address",
  "discount_offered",
] as const;

export type FieldKey = (typeof FIELD_ORDER)[number];
export type AgreementFields = Record<FieldKey, string>;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 32 random bytes, base64url encoded. Roughly 43 chars, unguessable, and safe
 * in a URL and in an SMS body without escaping.
 */
export function generateToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Only this hash is persisted. A table leak yields no usable links. */
export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(buf);
}

/**
 * Tamper evidence.
 *
 * Hashes template version plus field values in fixed order, so JSON key
 * ordering cannot change the result. Recomputing this later and comparing
 * against signatures.doc_sha256 proves the record was not altered after
 * signing.
 */
export async function hashAgreement(
  templateVersion: string,
  fields: Partial<AgreementFields>,
): Promise<string> {
  const canonical = [
    templateVersion,
    ...FIELD_ORDER.map((k) => `${k}=${(fields[k] ?? "").trim()}`),
  ].join("\n");
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return toHex(buf);
}

export function tokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
}

/**
 * Caller IP for the audit trail. Supabase sits behind a proxy, so
 * x-forwarded-for is the reliable source; leftmost entry is the real client.
 */
export function clientIp(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip");
}
