import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * Rep-side panel at the bottom of the call screen.
 *
 *   ask     -> "Would you prefer we do this via form or a verbal agreement?"
 *   verbal  -> hands off to the existing recording flow
 *   form    -> "Send to your phone or email?" -> send -> watch it land live
 *
 * The watching is the point: the rep confirms on the call instead of chasing it
 * afterward.
 *
 * NOTE: this imports `supabase` from ../supabaseClient. If Payout Pro creates
 * its client somewhere else, repoint that import.
 */

const NAVY = "#101f6b";
const BLUE = "#1b75eb";
const INK = "#1a1d24";
const BODY = "#3d424e";
const MUTED = "#6b7280";
const HAIRLINE = "#dce0e8";
const BLUE_SOFT = "#e2effb";

export default function AgreementPanel({
  agreementId,
  businessName,
  defaultPhone = "",
  defaultEmail = "",
  onVerbal,
  initialStep = "ask",
}) {
  const [step, setStep] = useState(initialStep);
  const [channel, setChannel] = useState("sms");
  const [dest, setDest] = useState(toE164(defaultPhone));
  const [status, setStatus] = useState("sent");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Postgres changes stream straight through Supabase Realtime, so there is no
  // polling and no websocket server of our own. Works identically in a Vite SPA.
  useEffect(() => {
    if (step !== "sent") return;

    const sub = supabase
      .channel(`agreement:${agreementId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "agreements",
          filter: `id=eq.${agreementId}`,
        },
        (payload) => {
          const next = payload.new.status;
          if (next === "viewed" || next === "signed") setStatus(next);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, [step, agreementId]);

  const phoneOk =
    channel !== "sms" || /^\+[1-9]\d{7,14}$/.test(toE164(dest));

  async function send() {
    if (channel === "sms" && !phoneOk) {
      setError("Enter a US phone number, e.g. (803) 555-1234.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const sendTo = channel === "sms" ? toE164(dest) : dest.trim();
      // invoke() attaches the signed-in rep's JWT automatically, which is what
      // the function's verify_jwt and requireRep check against.
      const { data, error: fnErr } = await supabase.functions.invoke(
        "agreement-send",
        { body: { agreementId, channel, sendTo } },
      );
      if (fnErr) {
        // FunctionsHttpError hides the real message in the Response body.
        let msg = fnErr.message;
        try {
          const b = await fnErr.context?.json?.();
          if (b?.error) msg = b.error;
        } catch { /* keep generic message */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      setStep("sent");
      setStatus("sent");
    } catch (e) {
      // Texting is unreliable until A2P is fully registered — steer to email.
      setError(
        channel === "sms"
          ? "Texting is temporarily unavailable — please use Email instead."
          : (e.message || "Could not send."),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={panel}>
      {step === "ask" && (
        <>
          <Script>
            Great, that all sounds good. I just want to confirm some details with
            you. Would you prefer we do this via form or a verbal agreement?
          </Script>
          <div style={{ display: "flex", gap: 12 }}>
            <button style={primary} onClick={() => setStep("channel")}>
              Form
            </button>
            <button style={secondary} onClick={onVerbal}>
              Verbal
            </button>
          </div>
        </>
      )}

      {step === "channel" && (
        <>
          <Script>
            Perfect. Would you like me to send that to your phone number or your
            email?
          </Script>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <Toggle
              active={channel === "sms"}
              onClick={() => {
                setChannel("sms");
                setDest(toE164(defaultPhone));
              }}
            >
              Text
            </Toggle>
            <Toggle
              active={channel === "email"}
              onClick={() => {
                setChannel("email");
                setDest(defaultEmail);
              }}
            >
              Email
            </Toggle>
          </div>

          <input
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            onBlur={() => channel === "sms" && setDest(toE164(dest))}
            placeholder={channel === "sms" ? "(803) 555-1234" : "name@example.com"}
            style={input}
          />

          {channel === "sms" && dest.trim() && !phoneOk && (
            <p style={{ ...errorText, color: "#a35a1a" }}>
              Enter a US phone number, e.g. (803) 555-1234.
            </p>
          )}
          {error && <p style={errorText}>{error}</p>}

          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <button
              style={{ ...primary, opacity: sending || !dest.trim() || !phoneOk ? 0.5 : 1 }}
              onClick={send}
              disabled={sending || !dest.trim() || !phoneOk}
            >
              {sending ? "Sending…" : "Send now"}
            </button>
            <button style={secondary} onClick={() => setStep("ask")}>
              Back
            </button>
          </div>
        </>
      )}

      {step === "sent" && (
        <LiveStatus
          status={status}
          channel={channel}
          businessName={businessName}
        />
      )}
    </div>
  );
}

function LiveStatus({ status, channel, businessName }) {
  const copy = {
    sent: {
      head: channel === "sms" ? "Text sent" : "Email sent",
      sub: "Stay on the line. You'll see it here the moment they open it.",
    },
    viewed: {
      head: "They opened it",
      sub: "They're filling in the discount now. Give them a second.",
    },
    signed: {
      head: `${businessName} signed`,
      sub: "You're done. Confirm it with them before you hang up.",
    },
  };
  const { head, sub } = copy[status];
  const signed = status === "signed";

  return (
    <div
      style={{
        background: signed ? BLUE_SOFT : "#f4f6f9",
        border: `1px solid ${signed ? BLUE : HAIRLINE}`,
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: signed ? BLUE : MUTED,
            flexShrink: 0,
          }}
        />
        <span
          style={{ fontSize: 16, fontWeight: 600, color: signed ? NAVY : INK }}
        >
          {head}
        </span>
      </div>
      <p style={{ fontSize: 14, lineHeight: 1.5, color: BODY, margin: "8px 0 0" }}>
        {sub}
      </p>
    </div>
  );
}

function Script({ children }) {
  return (
    <p
      style={{
        fontSize: 16,
        lineHeight: 1.6,
        color: INK,
        background: "#f4f6f9",
        borderLeft: `3px solid ${BLUE}`,
        borderRadius: 8,
        padding: "12px 14px",
        margin: "0 0 16px",
      }}
    >
      {children}
    </p>
  );
}

// Coerce a phone into E.164 for Twilio. US 10-digit -> +1XXXXXXXXXX; 11-digit
// starting with 1 -> +1...; already-'+' kept. Anything else is returned trimmed
// so the server validates it and shows a clear message.
function toE164(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return "+" + s.slice(1).replace(/\D/g, "");
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return s;
}

function Toggle({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        height: 44,
        borderRadius: 10,
        border: `1px solid ${active ? NAVY : HAIRLINE}`,
        background: active ? NAVY : "#fff",
        color: active ? "#fff" : INK,
        fontSize: 14,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

const panel = {
  background: "#fff",
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 16,
  padding: 24,
  fontFamily: "Inter, system-ui, sans-serif",
};
const primary = {
  flex: 1,
  height: 48,
  background: NAVY,
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontSize: 16,
  fontWeight: 500,
  cursor: "pointer",
};
const secondary = {
  flex: 1,
  height: 48,
  background: "#fff",
  color: INK,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 10,
  fontSize: 16,
  fontWeight: 500,
  cursor: "pointer",
};
const input = {
  width: "100%",
  height: 52,
  padding: 14,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 12,
  fontSize: 16,
  fontFamily: "inherit",
  color: NAVY,
  background: "#fff",
  colorScheme: "light",
  outlineColor: BLUE,
  boxSizing: "border-box",
};
const errorText = { fontSize: 14, color: "#a32626", margin: "12px 0 0" };
