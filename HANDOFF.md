# Handoff: e-signature for Payout Pro

Repo: `Batman587w784/Payout-Pro` (Vite + React SPA, one Supabase Edge Function).

Built against that stack specifically. An earlier version of this drop-in
targeted Next.js and was wrong for this repo; it has been discarded. Nothing
here uses `node:crypto`, server route handlers, or `NEXT_PUBLIC_*`.

**§2 is orientation, §3 is the work.** Read the existing code first and match
its conventions over the ones here. Report which §2 assumptions are wrong before
editing anything.

---

## 1. What landed

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260721000000_agreements.sql` | Schema, RLS, realtime |
| `supabase/config.functions.toml` | **verify_jwt settings. Merge into config.toml.** |
| `supabase/functions/_shared/crypto.ts` | Tokens and hashes via Web Crypto |
| `supabase/functions/_shared/context.ts` | CORS, service client, rep authorization |
| `supabase/functions/_shared/template.ts` | Field defs, measured PDF coordinates, terms |
| `supabase/functions/agreement-send/index.ts` | Mint token, send via Twilio or Resend |
| `supabase/functions/agreement-sign/index.ts` | Public load and submit |
| `supabase/functions/agreement-pdf/index.ts` | Stamp values onto the real PDF |
| `src/pages/SignAgreement.jsx` | Public signing page |
| `src/components/AgreementPanel.jsx` | Rep call panel, live status |
| `assets/discount-partnership-v1.pdf` | Template. **Upload to Storage, see §3.2.** |

Frontend files are `.jsx` with inline styles, matching the existing repo. No
TypeScript, no CSS framework assumed.

### Architecture, because it differs from a server-rendered app

Vite ships a browser bundle. There is no server runtime and no safe place in
`src/` for a privileged key. So every operation touching the service role key
lives in an Edge Function, and the SPA only ever holds the anon key. Three
functions replace what would otherwise be three API routes.

---

## 2. Assumptions to check first

1. **Supabase client location.** `AgreementPanel.jsx` imports
   `supabase` from `../supabaseClient`. The repo may create the client inline in
   `App.jsx` instead. Repoint the import.
2. **No router.** The root listing shows no `react-router`. §3.5 covers both
   cases. Check `package.json` before choosing.
3. **`org_members` does not exist.** It is referenced in two places: the RLS
   policies in the migration, and `requireRep()` in `_shared/context.ts`. Both
   must be repointed at however Payout Pro actually identifies a rep. **These
   two must agree with each other.**
4. **A merchants table may already exist.** The migration uses
   `create table if not exists`. If Payout Pro has an equivalent, delete that
   block and repoint the FK on `agreements`.
5. **Env var names.** The frontend expects `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. If the repo uses different names, adjust
   `SignAgreement.jsx`.
6. **`.env.local.txt`** at the repo root has an unusual extension. Vite reads
   `.env.local`. Worth confirming that is intentional.

---

## 3. Tasks

### 3.1 Run the migration
Rewrite the two RLS policies at the bottom to match the real rep model, then
apply. Afterward confirm `supabase_realtime` includes `agreements`; the rep
panel shows nothing without it.

### 3.2 Upload the PDF template to Storage
Edge Functions have no useful filesystem, so the template is fetched from a
private bucket at request time.

```
supabase storage create agreements          # private bucket
# upload assets/discount-partnership-v1.pdf as discount-partnership-v1.pdf
```

Bucket and object names are in `_shared/template.ts`.

### 3.3 Merge config.functions.toml into config.toml  ← highest risk step
The two public functions **must** have `verify_jwt = false`. The merchant
signing an agreement is not a Payout Pro user and has no JWT. Leave the default
on and every signing link returns 401 with no obvious cause.

`agreement-send` keeps `verify_jwt = true` and adds `requireRep()` on top.

### 3.4 Set function secrets
```
supabase secrets set \
  APP_URL=https://your-app-domain \
  TWILIO_ACCOUNT_SID=... \
  TWILIO_AUTH_TOKEN=... \
  TWILIO_MESSAGING_SERVICE_SID=... \
  RESEND_API_KEY=... \
  RESEND_FROM="Tailgate <agreements@yourdomain.com>"
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically. Do not set them by hand and do not copy the service role
key into `.env.local`.

`APP_URL` also drives the CORS allowlist in `_shared/context.ts`.

### 3.5 Route the signing page
`SignAgreement.jsx` takes a `token` prop.

**If react-router is installed:**
```jsx
<Route path="/sign/:token" element={<SignAgreementRoute />} />
// where SignAgreementRoute reads useParams().token
```

**If not** (likely, given the root listing), the smallest correct thing is a
path check in `App.jsx` before the normal app renders:
```jsx
const signMatch = window.location.pathname.match(/^\/sign\/(.+)$/);
if (signMatch) return <SignAgreement token={signMatch[1]} />;
```
Either way the host must serve `/sign/*` as the SPA index rather than 404ing.
On Vercel or Netlify that is the standard SPA rewrite.

### 3.6 Build the agreement-creation path
Nothing here inserts an `agreements` row. Something upstream must, when the rep
opens the call screen:

```js
await supabase.from("agreements").insert({
  merchant_id: merchant.id,
  school: merchant.school,
  template_version: "discount-partnership-v1",
  prefill: {
    business_name:    merchant.business_name,
    contact_person:   merchant.contact_person ?? "",
    phone:            merchant.phone ?? "",
    email:            merchant.email ?? "",
    address:          merchant.address ?? "",
    discount_offered: "",   // merchant fills this in
  },
  status: "draft",
});
```

`prefill` is a snapshot on purpose. Merchant records drift; signed agreements
must not.

### 3.7 Mount the rep panel
```jsx
<AgreementPanel
  agreementId={agreement.id}
  businessName={merchant.business_name}
  defaultPhone={merchant.phone}       // E.164, e.g. +18035551275
  defaultEmail={merchant.email}
  onVerbal={() => openRecordingScreen()}
/>
```
The existing recording flow keeps working. It is now reached through the Verbal
branch instead of being the default. On that branch, write `path: 'verbal'` and
the `recording_id` onto the agreement so both routes land in one queryable
place.

### 3.8 Deploy
```
supabase functions deploy agreement-send
supabase functions deploy agreement-sign --no-verify-jwt
supabase functions deploy agreement-pdf  --no-verify-jwt
```

---

## 4. On the existing send-info-email function

Prior review noted correctly that `verify_jwt` is on by default and
`functions.invoke` sends the caller's JWT, so it is not publicly open. Adding an
explicit in-function authorization check is still worthwhile: authentication
proves someone is signed in, not that they are allowed to trigger that action.
`requireRep()` in `_shared/context.ts` is a reusable pattern for that. Treat it
as an optional standalone task, not a prerequisite for this feature.

---

## 5. PDF field mapping (done, verified)

Measured off the real template and confirmed by rendering test values. US
Letter, 612 x 792pt, pdf-lib bottom-left origin.

| Field | x | y | Blank width |
| --- | --- | --- | --- |
| Business Name | 116 | 401 | 204 |
| Contact Person | 118 | 385 | 204 |
| Phone | 65 | 370 | 94 |
| Email | 207 | 370 | 134 |
| Address | 76 | 355 | 245 |
| Discount Offered | 34 | 273 | 360 |
| Partner Signature | 122 | 192 | 92 |
| Partner Date | 252 | 192 | 50 |
| Tailgate Rep | 154 | 164 | 71 |
| Rep Date | 262 | 164 | 50 |

Values shrink automatically to fit their blank rather than overflowing.

**One caveat.** The Discount Offered rule is rasterized inside a page image
rather than being live text, so its position was measured off the render. It is
the single most likely coordinate to need a nudge. Sign one test agreement, open
the PDF, adjust `STAMPS.discount_offered.y` in `_shared/template.ts` if needed.

---

## 6. Deliberate decisions

**Web Crypto instead of node:crypto.** Deno has no `node:crypto` by default and
all hashing is async as a result. Every `hashToken` call is awaited.

**The signing token stays valid for PDF reads after being burned for writes.**
Merchants need a durable copy to show staff. It cannot be reused to sign because
`used_at` is set. To tighten this, move the PDF function behind a merchant login
instead.

**`doc_sha256` hashes template version plus field values in fixed order**, not
raw JSON, so key ordering cannot change the result. Recomputing it later proves
the record was not altered after signing.

**Token burn happens before the signature insert.** Two racing submissions mean
the second matches zero rows and loses, so double-signing is impossible.

**Missing, expired, and used tokens return the same message.** Do not make that
error more specific.

**CORS is handled explicitly in every function.** The SPA and the functions are
on different origins, so each one needs the OPTIONS branch and the shared
headers. This is the most common thing to break when adding a fourth function
later.
