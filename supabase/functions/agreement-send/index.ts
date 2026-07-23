import {
  corsHeaders,
  json,
  preflight,
  requireRep,
  serviceClient,
} from "../_shared/context.ts";
import {
  generateToken,
  hashToken,
  tokenExpiry,
} from "../_shared/crypto.ts";

/**
 * POST /functions/v1/agreement-send
 * Body: { agreementId, channel: "sms" | "email", sendTo }
 *
 * Called by the rep mid-call. Mints a single-use token, sends the link, and
 * flips the agreement to "sent" so the rep screen starts watching.
 *
 * verify_jwt stays ON for this function. requireRep adds the authorization
 * layer on top: signed in is not the same as allowed to send agreements.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rep = await requireRep(req);
  if (!rep) return json({ error: "Unauthorized" }, 401);

  const { agreementId, channel, sendTo } = await req.json();

  if (channel !== "sms" && channel !== "email") {
    return json({ error: "Invalid channel" }, 400);
  }
  if (channel === "sms" && !/^\+[1-9]\d{7,14}$/.test(sendTo ?? "")) {
    return json({ error: "Phone must be E.164, e.g. +18035551234" }, 400);
  }
  if (channel === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sendTo ?? "")) {
    return json({ error: "Invalid email" }, 400);
  }

  const db = serviceClient();

  const { data: agreement, error: loadErr } = await db
    .from("agreements")
    .select("id, status, prefill")
    .eq("id", agreementId)
    .single();

  if (loadErr || !agreement) return json({ error: "Agreement not found" }, 404);
  if (agreement.status === "signed") return json({ error: "Already signed" }, 409);

  const prefill = agreement.prefill as Record<string, string>;

  // Plaintext token exists only in this function and in the outgoing message.
  const token = generateToken();

  const { error: tokenErr } = await db.from("agreement_tokens").insert({
    token_hash: await hashToken(token),
    agreement_id: agreement.id,
    channel,
    sent_to: sendTo,
    expires_at: tokenExpiry().toISOString(),
  });
  if (tokenErr) return json({ error: "Could not create link" }, 500);

  // Must be your own domain. Public shorteners get A2P campaigns rejected and
  // messages filtered.
  const link = `${Deno.env.get("APP_URL")}/sign/${token}`;

  let providerMessageId: string | null = null;
  let sendError: string | null = null;

  try {
    providerMessageId = channel === "sms"
      ? await sendSms(sendTo, prefill, link)
      : await sendEmail(sendTo, prefill, link);
  } catch (err) {
    sendError = err instanceof Error ? err.message : "Unknown send failure";
  }

  await db.from("delivery_log").insert({
    agreement_id: agreement.id,
    channel,
    provider: channel === "sms" ? "twilio" : "resend",
    provider_message_id: providerMessageId,
    status: sendError ? "failed" : "queued",
    error: sendError,
  });

  if (sendError) return json({ error: sendError }, 502);

  await db
    .from("agreements")
    .update({ status: "sent", path: "form" })
    .eq("id", agreement.id);

  return json({ ok: true, channel, sentTo: sendTo });
});

// ---------------------------------------------------------------------------

async function sendSms(
  to: string,
  prefill: Record<string, string>,
  link: string,
): Promise<string> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const auth = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID")!;

  // Keep this wording aligned with the sample messages on the A2P campaign.
  const body =
    `Tailgate Co: here is the discount partnership agreement for ` +
    `${prefill.business_name}. Review and sign: ${link}\n` +
    `Reply STOP to opt out.`;

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${sid}:${auth}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        MessagingServiceSid: messagingServiceSid,
        Body: body,
      }),
    },
  );

  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload.message ?? `Twilio error ${payload.code ?? res.status}`);
  }
  return payload.sid as string;
}

async function sendEmail(
  to: string,
  prefill: Record<string, string>,
  link: string,
): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM")!,
      to,
      subject: "Your Tailgate discount partnership agreement",
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;color:#1a1d24;
                    max-width:520px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:21px;font-weight:600;color:#101f6b;margin:0 0 16px">
            Your agreement is ready to sign
          </h1>
          <p style="font-size:16px;line-height:1.6;color:#3d424e;margin:0 0 24px">
            Everything is filled in for ${escapeHtml(prefill.business_name ?? "your business")}.
            Give it a read, confirm your discount, and add your signature.
          </p>
          <a href="${link}"
             style="display:inline-block;background:#101f6b;color:#fff;
                    text-decoration:none;font-size:16px;font-weight:500;
                    padding:14px 24px;border-radius:10px">
            Review and sign
          </a>
          <p style="font-size:13px;line-height:1.4;color:#6b7280;margin:24px 0 0">
            This link expires in 72 hours and can only be used once.
          </p>
        </div>
      `,
    }),
  });

  const payload = await res.json();
  if (!res.ok) throw new Error(payload.message ?? "Resend send failed");
  return payload.id as string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
