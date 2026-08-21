 Tailgate Payday — Merchant Calling & CRM Overhaul
**PRD v1.0 — for execution in Claude Code**
**Repo:** `Batman587w784/Payout-Pro` · **File:** `src/App.jsx` (single-file React 19 + Vite + Supabase app)

---

## 0. How to use this document

This PRD is broken into **6 independent phases**. Each phase is a complete, shippable unit — build it, test it, deploy it, move to the next. Don't attempt all six in one Claude Code session; scope creep across this many features in one sitting is how things half-break. Paste one phase at a time as its own instruction, referencing this doc for context.

**Before any phase:** run `npm run build` and `npx eslint src/App.jsx` after every change, same rules as always. Don't touch the known pre-existing `downloadStubPDF` bug unless a phase explicitly calls for it (Phase 5 does).

**Phase order matters.** Phases 1–3 are pure `App.jsx` changes, low risk, no new external dependencies — do these first. Phase 4 (SMS) and Phase 6 (e-sign) depend on things outside the repo (your Twilio setup, a PDF template) that need a short discovery step before Claude Code can build against them — see each phase's "Discovery required" box.

---

## Phase 1 — CRM mechanics: not-interested cooldown, callback redesign, click-anywhere-to-expand

**Goal:** Fix the three things actively causing friction in daily use, with no new infrastructure.

### 1.1 — "Not interested" cooldown instead of permanent burial

**Problem:** One outcome (not_interested) currently removes a lead from the active queue with no path back, even when the "no" was really "this caller handled it badly," not "this merchant will never say yes."

**Critical design point — who said no matters more than how many times.** A "no" from whoever answered the phone is not the same event as a "no" from the owner/GM. The cooldown must branch on this, not just on a count.

**When a caller marks `not_interested`, require one additional answer before saving:**

> **"Did you speak to the owner/manager?"** → `Yes, spoke to owner/GM` · `No, gatekeeper/staff only` · `Not sure`

**Cooldown logic — two independent ladders:**

| Decline reason | 1st | 2nd | 3rd | 4th+ |
|---|---|---|---|---|
| Gatekeeper / staff only (or Not sure) | **1 day** | **3 days** | **7 days** | stays on 7-day cycle, never permanently suppressed |
| Spoke to owner / GM | **3 days** | **7 days** | **30 days** | **365 days** + flag `permanentlyDeclined` |

Rationale: campaigns run on a roughly two-week window, so a staff-level "no" should bounce back into the queue almost immediately for a different caller to retry — the decision-maker has still never actually been asked, so it never earns permanent suppression. A real owner-level "no" still gets two fast retries inside the season before escalating to long timeouts.

**Count the two ladders separately.** Two gatekeeper brush-offs followed by one owner-no is a **1st** owner-level decline (3 days), not a 3rd decline (30 days). Gatekeeper declines must never advance a lead up the owner ladder.

**Fields to add to each call record:**
- `gatekeeperDeclineCount` (default 0) — gatekeeper/unsure ladder counter
- `ownerDeclineCount` (default 0) — owner/GM ladder counter
- `declineHistory` (array) — each decline as `{date, callerId, declineLevel, notes}`, so admin sees the real pattern rather than just a number
- `lastDeclineLevel` — `gatekeeper` | `owner` | `unsure`
- `nextEligibleDate`
- `permanentlyDeclined` (bool) — set only at owner-ladder step 4

**Additional behavior:**
- A lead whose `nextEligibleDate` has passed automatically reappears in the caller queue as `to_call`. Compute this on read (`nextEligibleDate <= today`) — the app has no backend scheduler, so don't design around a cron job.
- **Route retries to a different caller where possible.** If a lead was declined at gatekeeper level and there's more than one caller assigned to that Group, prefer reassigning to a caller who hasn't tried it yet. The whole point is a second voice getting through where the first didn't. If only one caller exists, return it to them anyway.
- **Admin visibility:** show both counters, `lastDeclineLevel`, and `nextEligibleDate` on each lead in the admin Calls view; expand to reveal `declineHistory`. This exists specifically to make caller-quality patterns visible — a caller whose leads are *all* "gatekeeper only" is a coaching signal about the caller, while a caller racking up owner-level declines far faster than peers is a different signal about their pitch.
- **Admin override:** a "call again now" button that clears the cooldown immediately, for when you want a stronger closer to retry without waiting.

### 1.2 — Simplified callback flow

**Problem:** Current callback logging requires manually typing a date, which is slow and error-prone mid-call.

**Replace the callback form with exactly three fields:**
1. **When are they available** — a simple set of tappable presets (Morning / Afternoon / Evening / "Anytime") rather than a free time picker, plus a date (default: tomorrow, but a quick date picker for "next week" etc.)
2. **When to call them back** — same tappable structure: a date, defaulting sensibly (tomorrow), not a raw text field.
3. **Notes** — free text, optional.

No manual HH:MM typing. Store as a simple structured object (`{callbackDate, availability, notes}`) rather than free text, so it can power the reminder banner in 1.3.

### 1.3 — Callback due banner (homepage)

**Problem:** Callbacks get forgotten because nothing surfaces them proactively.

**Behavior:** On the caller's Home screen, if any assigned call has `callbackDate <= today`, show a prominent banner above everything else — not a subtle badge. Large, high-contrast, impossible to miss: "📞 Follow up with [Business] today — [notes if any]." Multiple due callbacks stack as multiple banner rows. Clicking a banner row opens that lead directly (ties into 1.4).

### 1.4 — Click name to expand, not just the button

**Problem:** Only the "Log Call" button opens a lead; clicking the row text does nothing.

**Fix:** Make the entire lead row clickable (the business name / contact area, not just the button) to expand/open the same call-logging view. Keep the explicit button too — just make the whole row a bigger, more forgiving click target. This is a small, contained change to the existing `CallerHome` row rendering.

---

## Phase 2 — Caller homepage redesign: script access, group progress, visual interactivity

**Goal:** Make the caller's home screen feel alive and give them fast access to reference material instead of a bare list.

### 2.1 — Script as a clickable reference button

Add a persistent button/icon on the Home screen (not buried in the Calling screen only) that opens the verification script in a read-only modal — callers should be able to glance at it anytime, even outside an active call, to rehearse or double check wording. Reuse the script content/component from the Calling screen rather than duplicating it.

### 2.2 — Group-level progress visibility

**Problem:** Callers can't see the big picture — how many discounts a given group/organization needs vs. has.

**There is no target or maximum.** The goal is always "as many as we can get," so do **not** build a progress-toward-a-goal bar or an "N remaining" count — that framing implies a finish line that doesn't exist and would make a strong campaign look "done."

**Instead, show accumulation:**
- **Discounts secured so far** for that Group — a live count that only goes up.
- **Total card value** next to it — the sum of the discount tiers secured (e.g. "18 discounts secured · $800 in card value"). This is the more motivating number of the two, since it makes each additional discount feel like it's adding tangible worth to the card rather than filling a quota.

**Data:**
- New `po_groups` structure: `{id, name, logoUrl, createdAt}` — note: **no `targetCount` field**.
- Each call record gets a `groupId` reference.
- Secured count and card value are computed from call records with approved/verified agreements tied to that `groupId` — not stored, so they can't drift out of sync.

**Visual treatment:** since there's no percentage to fill, use an accumulating counter / stacked visual rather than a progress bar. Your design system's "momentum" language fits here — framing it as growth ("+3 this week") rather than completion.

### 2.3 — Visual redesign

Apply your `navy-blue-saas` design system (already in your skills) consistently across the caller portal — currently it's using the plainer white-card style from the original build. Bring in the group logo (from 2.2) as a visual anchor per group section, and break up the flat list with real visual hierarchy: group header (logo + name + secured count + card value), then that group's leads nested beneath it.

**Note:** the design system's progress-bar component is *not* the right fit here — see 2.2, there's no target to fill toward. Use the accumulating counter treatment instead, and reserve the system's "momentum" copy for growth framing ("+3 this week"), not completion framing ("8 to go").

---

## Phase 3 — "Needs more info" redesign + group management (logos, editing, bulk import with dedup)

### 3.1 — Redesign "Needs more info"

**Current state:** button exists, does nothing meaningful.

**New behavior:** When a merchant doesn't know what discount to offer yet, "Needs more info" should:
- Send them a **longer-form email** (not the short discount-specific one) — an overview of what Tailgate does, how the program works, and general benefits, without presupposing a specific discount tier.
- End that email with a link to the **same agreement/signing flow**, but where the discount field is **left blank for them to fill in** rather than pre-set by you.
- This reuses the eventual e-sign flow from Phase 6 — build the trigger and email content now; wire the actual link once Phase 6 exists. If Phase 6 isn't built yet when this ships, the link can point to a placeholder/coming-soon state.

### 3.2 — Editable, persistent Groups with logos (super-admin)

Builds on the `po_groups` structure from 2.2:
- Admin screen to create/edit a Group: name, logo upload, target discount count.
- Logo upload → Supabase Storage (new bucket, e.g. `group-logos`, public-read since these are just organization logos, not sensitive).
- Groups persist and can be added to indefinitely — new fundraising partners get added without touching code, matching your "don't want to keep changing how it works" requirement.

### 3.3 — Bulk import with column mapping + duplicate detection

Builds directly on the column-mapping spec from your earlier message (phone, address, email, category, school, notes):
- CSV upload → user maps their columns to app fields (dropdown per column, like the merchant-discount CSV import already does elsewhere in the app — reuse that pattern).
- Assign the imported batch to a **Group** (from 3.2) and optionally pre-assign to a caller, or leave unassigned for admin to distribute later.
- **Duplicate detection on import:**
  - **High-confidence duplicate** (exact or near-exact match on business name + phone, or business name + address) → auto-skip, don't create a second lead, show a count of "N duplicates skipped" after import.
  - **Ambiguous match** (similar name only, e.g. "Joe's Pizza" vs "Joes Pizza Downtown") → don't auto-decide. Surface these in a review list post-import where admin clicks Confirm (treat as duplicate, discard) or Deny (treat as separate, keep both) per item.
  - Use a simple fuzzy-match (normalize whitespace/case/punctuation, then compare) — this doesn't need a heavy library, a straightforward string-similarity check against existing leads in the same Group is sufficient at your current scale.

---

## Phase 4 — Dual-source audio recording + employee SMS callback reminders

### 4.1 — Computer/tab audio as a secondary recording source

**Problem:** Calls made via Google Voice (or similar browser-based calling) only have the caller's mic audio captured — the other party's voice, which is playing out of the computer's speakers, isn't captured by the existing mic-only recorder.

**Behavior:** Add a toggle (your "slider") on the Calling screen: **"Also capture computer audio."** When on, in addition to the existing mic stream, capture tab/system audio via `getDisplayMedia({audio: true, video: false})` (Chrome-only capture of a shared tab's audio — confirmed fine since your callers are all on Chrome) and mix both streams before recording, so the saved file has both sides of the conversation.

**Technical note for Claude Code:** `getDisplayMedia` for audio-only in Chrome requires the user to pick a source (a tab/window) even though no video is shown — there's a permission prompt each time this is unavailable to skip. Mix the two `MediaStreamTrack`s via the Web Audio API (`AudioContext` + `MediaStreamAudioSourceNode` for each, summed through a `GainNode`, output via `MediaStreamAudioDestinationNode`) before feeding the combined stream into `MediaRecorder` — don't try to record two separate files and merge after, that adds real complexity for no benefit here.

Default the slider to **off** (mic-only) so callers not using Google Voice aren't prompted for tab-sharing unnecessarily.

### 4.2 — Employee SMS callback reminders

**Discovery required before building:** you mentioned Twilio-style texting is already working elsewhere in your systems (form texts). Claude Code should first locate that existing integration — check for any serverless functions, webhooks, or a separate service Payout Pro might already call, and whether credentials exist anywhere accessible to this project (Vercel env vars, another repo). **This is not yet wired into `Payout-Pro` per the current codebase** — confirm where the existing SMS capability actually lives before assuming it can be reused directly.

**Once the integration point is confirmed, build:**
- Add a `phone` field to employee records if not already present (it may not be, since employee records only tracked payout info previously).
- **First-login prompt:** if an employee's phone number is blank, show a one-time, dismissible-but-persistent prompt asking them to add it — don't block the app, but don't let them forget either (reappear each session until filled in).
- When a callback's `callbackDate` becomes due (same trigger as the Phase 1.3 homepage banner), also fire an SMS to that caller's phone: "Reminder: follow up with [Business] today. [notes]." This needs a trigger mechanism — since this app has no backend cron, the most realistic approach is firing the check-and-send **client-side on load** (whoever logs in that day triggers checks for their own due callbacks) rather than a true server-side scheduled job, unless you already have serverless infrastructure elsewhere Claude Code discovers in the step above. Flag this limitation clearly to Sean: reminders will only fire when someone opens the app, not at a guaranteed wall-clock time, unless real backend scheduling is added later.

---

## Phase 5 — Cleanup (low-risk, do anytime)

- Fix or remove the `downloadStubPDF` reference (currently referenced but undefined — pay-stub "Download" button throws).
- Revert/remove the temporary Supabase diagnostic logging added during the sync-bug investigation, once confirmed stable in production for a few days.
- Delete `.env.local.txt` from the repo (leftover, misnamed, contains a malformed URL) — confirm nothing depends on it first (nothing currently does).

---

## Phase 6 — E-signature / PDF overhaul

**This is the highest-effort, highest-risk phase — do it last, after the simpler phases have shipped and Claude Code has more context on the codebase.**

### What you actually want (per your clarification)

Not a form where fields get typed in and then get baked into a PDF after the fact. You want: merchant taps a link on their phone → they see what **looks and reads like a filled-out form/document**, full-page, mobile-friendly, with everything Tailgate already knows (business name, contact, discount tier if set, locations, decision-maker info) **already visible on the page as filled fields** — not blank inputs they have to populate. The only things left for them to actively provide are:
- The discount details, if not already set (ties into Phase 3.1's "needs more info" flow, where this stays blank on purpose)
- Their signature
- Any final confirmation checkbox/text ("I agree...")

### Recommended approach

Given the constraint "we don't want fields autofilling [into a generic form], we want it to look like the actual filled document" — this is really describing **a styled HTML page that visually resembles a filled PDF/contract, rendered in-browser, mobile-first**, rather than literal PDF field-filling (which is what tools like PandaDoc/Zoho actually do under the hood — they're rendering a document view, not a raw form). Two real options:

**Option A — HTML "document view" (recommended first pass):** Build a dedicated page/route styled to look like a formal filled document — the pdf skill's visual conventions, letterhead-style header, pre-filled fields shown as static text (not editable inputs) with a clearly-marked blank section for discount + a signature capture area (canvas-based signature pad, e.g. a lightweight signature-pad library) + agree checkbox. On submit, generate an actual PDF snapshot of the completed page (server-side or client-side rendering to PDF) for your records and for emailing back to the merchant, using the existing `pdf` skill's approach for PDF generation. This avoids needing real PDF form-field manipulation entirely and is much faster to build correctly.

**Option B — True PDF form fields (only if Option A isn't good enough after seeing it):** Use a real PDF template with actual form fields, pre-fill via a PDF library (server-side, since client-side PDF form-filling in-browser is fragile), serve the filled PDF for review + signature. More faithful to "it's a real PDF" but meaningfully more engineering — a filled PDF viewed on mobile still isn't as smooth as a native HTML page, and getting signature capture into a PDF form field correctly is its own project.

**Recommendation: build Option A first, actually look at it on a phone, and only invest in Option B if Option A genuinely doesn't feel like "a real document" once built.** This matches your own framing ("if you can just show them that full-page form... that is fine").

### Source document (confirmed)

The real agreement is the **"Tailgate Co. — Discount Card Partnership Agreement"** (one page). Sean has it in Google Docs and can export to PDF / DOCX / plain text. **Get this export before building this phase** — the document view must reproduce its actual copy and layout, not an approximation.

**Fields on the agreement, and where each comes from:**

| Field on document | Source |
|---|---|
| Business Name | pre-filled from call record |
| Contact Person | pre-filled from call record |
| Phone | pre-filled from call record |
| Email | pre-filled from call record |
| Address | pre-filled from call record (multi-location: list all) |
| **Discount Offered** (% off, BOGO, etc.) | **pre-filled if known — left blank for merchant to complete in the Phase 3.1 "needs more info" flow** |
| Partner Signature + Date | **merchant provides** (signature pad + auto-dated) |
| Tailgate Representative + Date | pre-filled from the logged-in caller |

Everything above the signature line — the "Thank You for supporting our local community" preamble, the "This initiative supports" bullets, the honor-the-discount paragraph, the redemption terms, the merchant-dashboard QR/link, and the NFC/printed-card note — is **static contract copy that must be reproduced verbatim** from the export. It's legal language; do not paraphrase or restyle it.

### Related: source copy for Phase 3.1

Sean also has a **"How Tailgate Works For Businesses"** one-pager (free advertising / no cost / 3-step: submit an offer → we promote → you gain customers year-round / real-time merchant dashboard tracking). This is the source material for the longer-form "needs more info" email in Phase 3.1 — pull the copy from it rather than writing new marketing language from scratch. Same export applies.

---

## Open questions to resolve before Phase 4 and Phase 6 specifically

1. **SMS:** where does the existing Twilio-style integration actually live, and are its credentials accessible to this project?
2. **E-sign:** should the generated PDF-of-record be stored in Supabase Storage (consistent with how call recordings are stored) and linked from the admin Calls view, so approved agreements are found the same way recordings are?
3. **Cooldown periods (1.1): RESOLVED** — two independent ladders. Gatekeeper: 1 / 3 / 7 days, then holds at 7 forever (never permanently suppressed). Owner/GM: 3 / 7 / 30 / 365 days, permanent flag at step 4. Counters tracked separately. See the table in 1.1.
4. **Group targets (2.2): RESOLVED** — there is no target. Show secured count + card value, never "N of M."
5. **Source documents (Phase 6 / 3.1): PENDING** — Sean to export the Partnership Agreement and the "How Tailgate Works" one-pager from Google Docs (PDF + text). Both phases are blocked on this.
