import { serviceClient } from "../_shared/context.ts";

/**
 * followup-reminders — daily cron job.
 *
 * Texts each caller whose callback is due today, once per callback. Schedule it
 * once a day (e.g. 9am) in the Supabase dashboard: Edge Functions -> this function
 * -> add a Cron schedule ("0 9 * * *"). Protect it with a shared secret so only the
 * scheduler can trigger it: set a CRON_SECRET function secret and have the schedule
 * send it as the `x-cron-secret` header.
 *
 * Requires the Twilio secrets already used by agreement-send:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID
 * SMS only actually delivers once your Twilio A2P 10DLC registration is approved.
 */
Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }

  const db = serviceClient();
  const load = async (key: string) => {
    const { data } = await db.from("app_data").select("value").eq("key", key)
      .maybeSingle();
    try {
      return data ? JSON.parse(data.value) : [];
    } catch {
      return [];
    }
  };

  const calls = await load("po_calls");
  const emps = await load("po_emp");
  const today = new Date().toISOString().slice(0, 10);
  const phoneOf = (id: string) =>
    (emps.find((e: any) => e.id === id) || {}).phone as string | undefined;

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const auth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const svc = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  const canSend = !!(sid && auth && svc);

  let sent = 0;
  let changed = false;
  const next = [];

  for (const c of calls as any[]) {
    let out = c;
    const due = c.status === "callback" && c.callbackDate &&
      c.callbackDate <= today && c.callerId &&
      c.followupTextedFor !== c.callbackDate;
    if (due && canSend) {
      const phone = phoneOf(c.callerId);
      if (phone) {
        try {
          const body =
            `Reminder: follow up with ${c.business || "a lead"} today.`;
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: "Basic " + btoa(`${sid}:${auth}`),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                To: toE164(phone),
                MessagingServiceSid: svc!,
                Body: body,
              }),
            },
          );
          if (res.ok) {
            out = { ...c, followupTextedFor: c.callbackDate };
            sent++;
            changed = true;
          }
        } catch {
          // skip this one; try again on the next run
        }
      }
    }
    next.push(out);
  }

  if (changed) {
    await db.from("app_data").upsert({
      key: "po_calls",
      value: JSON.stringify(next),
    });
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});

function toE164(raw: string): string {
  const s = (raw || "").trim();
  if (s.startsWith("+")) return "+" + s.slice(1).replace(/\D/g, "");
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return s;
}
