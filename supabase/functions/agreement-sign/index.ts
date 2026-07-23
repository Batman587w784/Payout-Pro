import { corsHeaders, json, preflight, serviceClient } from "../_shared/context.ts";
import {
  clientIp,
  FIELD_ORDER,
  hashAgreement,
  hashToken,
  type AgreementFields,
} from "../_shared/crypto.ts";
import { AGREEMENT_BODY } from "../_shared/template.ts";

/**
 * Public signing endpoint. The merchant is not a Payout Pro user and will never
 * be signed in, so this function MUST run with verify_jwt = false. See
 * supabase/config.toml. The token is the credential.
 *
 *   GET  /functions/v1/agreement-sign?token=...   load the agreement
 *   POST /functions/v1/agreement-sign?token=...   submit the signature
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "Missing token" }, 400);

  if (req.method === "GET") return load(token);
  if (req.method === "POST") return submit(req, token);
  return json({ error: "Method not allowed" }, 405);
});

// ---------------------------------------------------------------------------

async function load(token: string): Promise<Response> {
  const db = serviceClient();
  const { data: row } = await db
    .from("agreement_tokens")
    .select(
      "agreement_id, expires_at, used_at, " +
        "agreements(id, status, prefill, template_version)",
    )
    .eq("token_hash", await hashToken(token))
    .maybeSingle();

  // One generic message for missing, expired, and used. Do not tell an
  // attacker which of the three it was.
  const dead = json({ error: "This link is no longer valid." }, 404);

  if (!row || row.used_at) return dead;
  if (new Date(row.expires_at) < new Date()) return dead;

  const agreement = row.agreements as any;
  if (!agreement || agreement.status === "void") return dead;

  // Mark viewed so the rep sees movement while still on the call.
  if (agreement.status === "sent") {
    await db.from("agreements").update({ status: "viewed" }).eq("id", agreement.id);
  }

  return json({
    prefill: agreement.prefill,
    body: AGREEMENT_BODY,
    templateVersion: agreement.template_version,
    alreadySigned: agreement.status === "signed",
  });
}

async function submit(req: Request, token: string): Promise<Response> {
  const payload = await req.json();

  // Consent to transact electronically is a hard gate, not a formality.
  if (!payload.esignConsent) {
    return json({ error: "Electronic signature consent is required." }, 400);
  }
  if (!payload.signerName?.trim() || !payload.signatureValue?.trim()) {
    return json({ error: "Name and signature are required." }, 400);
  }

  // The discount is the whole point of the agreement. Refuse a blank one.
  const fields = (payload.fields ?? {}) as AgreementFields;
  for (const key of FIELD_ORDER) {
    if (key === "email") continue; // optional on the paper form
    if (!String(fields[key] ?? "").trim()) {
      return json(
        { error: `Missing required field: ${key.replace(/_/g, " ")}` },
        400,
      );
    }
  }

  const db = serviceClient();
  const tokenHash = await hashToken(token);

  const { data: row } = await db
    .from("agreement_tokens")
    .select(
      "agreement_id, channel, expires_at, used_at, " +
        "agreements(id, status, template_version)",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    return json({ error: "This link is no longer valid." }, 404);
  }

  const agreement = row.agreements as any;
  if (agreement.status === "signed") return json({ error: "Already signed." }, 409);

  const now = new Date().toISOString();

  // Burn the token first. If two submissions race, the second matches zero
  // rows and loses, so we cannot double-sign.
  const { data: burned } = await db
    .from("agreement_tokens")
    .update({ used_at: now })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .select("token_hash");

  if (!burned || burned.length === 0) {
    return json({ error: "Already signed." }, 409);
  }

  const { error: sigErr } = await db.from("signatures").insert({
    agreement_id: agreement.id,
    signer_name: payload.signerName.trim(),
    signer_title: payload.signerTitle?.trim() || null,
    submitted_fields: fields,
    signature_value: payload.signatureValue,
    signature_kind: payload.signatureKind ?? "typed",
    esign_consent_at: now,
    doc_sha256: await hashAgreement(agreement.template_version, fields),
    ip: clientIp(req.headers),
    user_agent: req.headers.get("user-agent"),
    channel: row.channel,
  });

  if (sigErr) {
    // Release the token so a genuine retry can succeed.
    await db
      .from("agreement_tokens")
      .update({ used_at: null })
      .eq("token_hash", tokenHash);
    return json({ error: "Could not save signature." }, 500);
  }

  // This update is what the rep screen is subscribed to.
  await db.from("agreements").update({ status: "signed" }).eq("id", agreement.id);

  return json({ ok: true });
}
