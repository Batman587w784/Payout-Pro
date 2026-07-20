// Supabase Edge Function: send-info-email
// Sends the "needs more info" email to a merchant via Resend.
//
// Required secrets (Supabase Dashboard → Project Settings → Edge Functions → Secrets,
// or:  supabase secrets set RESEND_API_KEY=...  FROM_EMAIL="Tailgate Fundraising <info@yourdomain.com>")
//   RESEND_API_KEY  — your Resend API key
//   FROM_EMAIL      — verified sender, e.g.  Tailgate Fundraising <info@yourdomain.com>
//
// The client calls this via supabase.functions.invoke('send-info-email', { body: {...} }),
// which passes the signed-in user's JWT, so only logged-in users can send.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { to, subject, text, replyTo } = await req.json();
    if (!to || !subject || !text) {
      return json({ error: "Missing 'to', 'subject', or 'text'." }, 400);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM_EMAIL = Deno.env.get("FROM_EMAIL");
    if (!RESEND_API_KEY || !FROM_EMAIL) {
      return json(
        { error: "Email isn't configured yet — set RESEND_API_KEY and FROM_EMAIL secrets." },
        500,
      );
    }

    const payload: Record<string, unknown> = {
      from: FROM_EMAIL,
      to: [to],
      subject,
      text,
    };
    if (replyTo) payload.reply_to = replyTo;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return json({ error: data?.message || "Resend rejected the email." }, 400);
    }
    return json({ ok: true, id: data?.id ?? null });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
