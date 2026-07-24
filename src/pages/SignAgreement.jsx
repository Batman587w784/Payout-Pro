import { useEffect, useState } from "react";

/**
 * Public signing page. Rendered for merchants who are NOT signed in, so it
 * talks to the agreement-sign Edge Function using only the anon key.
 *
 * Mount at /sign/:token. See HANDOFF.md section 3.5 for the two options
 * depending on whether react-router is already installed.
 */

const NAVY = "#101f6b";
const BLUE = "#1b75eb";
const INK = "#1a1d24";
const BODY = "#3d424e";
const MUTED = "#6b7280";
const PAGE = "#f6f7fa";
const HAIRLINE = "#dce0e8";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

const FIELD_ORDER = [
  "business_name",
  "contact_person",
  "phone",
  "email",
  "address",
  "discount_offered",
];

const FIELD_LABELS = {
  business_name: "Business name",
  contact_person: "Contact person",
  phone: "Phone",
  email: "Email",
  address: "Address",
  discount_offered: "Discount offered",
};

const EMPTY = {
  business_name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  discount_offered: "",
};

export default function SignAgreement({ token }) {
  const [fields, setFields] = useState(EMPTY);
  const [body, setBody] = useState("");
  const [loadError, setLoadError] = useState(null);
  const [ready, setReady] = useState(false);

  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${FN_URL}/agreement-sign?token=${encodeURIComponent(token)}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setFields({ ...EMPTY, ...j.prefill });
        setBody(j.body);
        setSignerName(j.prefill?.contact_person ?? "");
        if (j.alreadySigned) setDone(true);
        setReady(true);
      })
      .catch((e) => setLoadError(e.message));
  }, [token]);

  function set(key, value) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${FN_URL}/agreement-sign?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: ANON,
            Authorization: `Bearer ${ANON}`,
          },
          body: JSON.stringify({
            fields,
            signerName,
            signerTitle,
            signatureValue: signerName,
            signatureKind: "typed",
            esignConsent: consent,
          }),
        },
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setDone(true);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Shell>
        <h1 style={h1}>This link is no longer valid</h1>
        <p style={p}>
          Signing links expire after 72 hours and work only once. Ask your
          Tailgate rep to send a fresh one.
        </p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <h1 style={{ ...h1, color: NAVY, fontSize: 25 }}>You're all set</h1>
        <p style={p}>
          Your agreement is signed. Download a copy to keep, or to show your
          staff so they know how to redeem the discount.
        </p>
        <a
          href={`${FN_URL}/agreement-pdf?token=${encodeURIComponent(token)}`}
          style={linkButton}
        >
          Download your agreement
        </a>
      </Shell>
    );
  }

  if (!ready) {
    return (
      <Shell>
        <p style={{ ...p, margin: 0, color: MUTED }}>Loading…</p>
      </Shell>
    );
  }

  const complete = FIELD_ORDER.every(
    (k) => k === "email" || String(fields[k]).trim().length > 0,
  );
  const canSign =
    complete && signerName.trim().length > 1 && consent && !submitting;

  return (
    <Shell>
      <p style={eyebrow}>Discount card partnership agreement</p>
      <h1 style={{ ...h1, color: NAVY, fontSize: 25 }}>
        {fields.business_name || "Your business"}
      </h1>

      <div
        style={{
          border: `1px solid ${HAIRLINE}`,
          borderRadius: 12,
          overflow: "hidden",
          background: "#fff",
          margin: "0 0 12px",
        }}
      >
        <embed
          src="/discount-partnership-v1.pdf#toolbar=0"
          type="application/pdf"
          style={{ width: "100%", height: 520, border: "none", display: "block" }}
        />
      </div>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 24px" }}>
        Can’t see the agreement above?{" "}
        <a href="/discount-partnership-v1.pdf" target="_blank" rel="noreferrer" style={{ color: BLUE }}>
          Open it in a new tab
        </a>
        . Fill in your details below to sign.
      </p>

      <div style={terms}>{body}</div>

      <h2 style={h2}>Your details</h2>
      {FIELD_ORDER.filter((k) => k !== "discount_offered").map((key) => (
        <Field key={key} label={FIELD_LABELS[key]}>
          <input
            value={fields[key]}
            onChange={(e) => set(key, e.target.value)}
            style={input}
            inputMode={key === "phone" ? "tel" : undefined}
          />
        </Field>
      ))}

      <h2 style={h2}>Your discount</h2>
      <p style={{ ...p, fontSize: 14, margin: "0 0 8px" }}>
        Spell out the full offer and any conditions — such as a minimum
        purchase, exclusions, or when it applies. For example: "15% off any
        purchase over $25, excludes alcohol," "Buy one get one free, dine in
        only," or "$5 off, one per customer per visit."
      </p>
      <textarea
        value={fields.discount_offered}
        onChange={(e) => set("discount_offered", e.target.value)}
        rows={3}
        placeholder="% off / BOGO / free item, any minimum purchase, and special conditions…"
        style={{ ...input, height: "auto", padding: 14, resize: "vertical" }}
      />

      <h2 style={h2}>Sign</h2>
      <Field label="Your name">
        <input
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          style={input}
          autoComplete="name"
        />
      </Field>
      <Field label="Your role">
        <input
          value={signerTitle}
          onChange={(e) => setSignerTitle(e.target.value)}
          placeholder="Owner, general manager…"
          style={input}
        />
      </Field>

      <label style={consentRow}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ width: 18, height: 18, marginTop: 2, accentColor: BLUE }}
        />
        <span style={{ fontSize: 14, lineHeight: 1.5, color: BODY }}>
          I agree to sign this electronically, and typing my name above counts
          as my signature.
        </span>
      </label>

      {error && <p style={errorText}>{error}</p>}

      <button
        onClick={submit}
        disabled={!canSign}
        style={{
          ...primaryButton,
          background: canSign ? NAVY : "#d7dbef",
          cursor: canSign ? "pointer" : "not-allowed",
        }}
      >
        {submitting ? "Signing…" : "Agree and sign"}
      </button>

      <p
        style={{ fontSize: 13, lineHeight: 1.4, color: MUTED, margin: "16px 0 0" }}
      >
        We record the date, time, and device you signed from as part of the
        agreement record.
      </p>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: PAGE,
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        padding: "32px 16px",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          background: "#fff",
          border: `1px solid ${HAIRLINE}`,
          borderRadius: 16,
          padding: 24,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        style={{
          display: "block",
          fontSize: 14,
          fontWeight: 500,
          color: INK,
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const h1 = { fontSize: 21, fontWeight: 600, color: INK, margin: "0 0 8px" };
const h2 = { fontSize: 18, fontWeight: 600, color: INK, margin: "24px 0 12px" };
const p = { fontSize: 16, lineHeight: 1.6, color: BODY, margin: "0 0 24px" };
const eyebrow = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.6px",
  textTransform: "uppercase",
  color: MUTED,
  margin: "0 0 8px",
};
const terms = {
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 12,
  padding: 16,
  maxHeight: 260,
  overflowY: "auto",
  fontSize: 14,
  lineHeight: 1.5,
  color: BODY,
  whiteSpace: "pre-wrap",
};
const input = {
  width: "100%",
  height: 52,
  padding: 14,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 12,
  fontSize: 16,
  color: NAVY,
  background: "#fff",
  colorScheme: "light",
  fontFamily: "inherit",
  outlineColor: BLUE,
  boxSizing: "border-box",
};
const consentRow = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  margin: "8px 0 24px",
  cursor: "pointer",
};
const primaryButton = {
  width: "100%",
  height: 48,
  color: "#fff",
  border: "none",
  borderRadius: 10,
  fontSize: 16,
  fontWeight: 500,
};
const linkButton = {
  display: "inline-block",
  background: NAVY,
  color: "#fff",
  textDecoration: "none",
  fontSize: 16,
  fontWeight: 500,
  padding: "14px 24px",
  borderRadius: 10,
};
const errorText = { fontSize: 14, color: "#a32626", margin: "0 0 16px" };
