-- Tailgate e-signature for Payout Pro: Discount Card Partnership Agreement
--
-- The signer is the MERCHANT (business owner), not the chapter. School and
-- chapter are campaign context only and are nullable, because a merchant can
-- be signed before their card is assigned to a campaign.

create extension if not exists pgcrypto;

create type agreement_status as enum ('draft', 'sent', 'viewed', 'signed', 'void');
create type agreement_path   as enum ('form', 'verbal');
create type delivery_channel as enum ('sms', 'email');

-- ---------------------------------------------------------------------------
-- agreements
--
-- Payout Pro has no relational `merchants` table — "merchants" are JSON lead
-- records in app_data (key 'po_calls') with genId() string ids. So the
-- original merchants table + FK are removed: merchant_id is a plain text
-- soft-reference to that lead id, and `prefill` snapshots the fields shown to
-- the signer. The snapshot is the source of truth for the signed record; the
-- lead JSON is free to drift.
-- ---------------------------------------------------------------------------
create table agreements (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      text not null,   -- Payout Pro lead id (app_data 'po_calls'); no FK by design

  school           text,
  chapter_id       uuid,

  template_version text not null default 'discount-partnership-v1',

  -- Snapshot of the six agreement fields as shown to the signer. Never
  -- re-derive from merchants later: merchant records drift, signed records
  -- must not.
  prefill          jsonb not null,

  status           agreement_status not null default 'draft',
  path             agreement_path,

  -- Set when the rep takes the verbal branch instead of the form branch.
  recording_id     text,

  -- Tailgate countersignature. The PDF has a second signature line.
  rep_name         text,
  rep_signed_at    timestamptz,

  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index agreements_merchant_idx on agreements (merchant_id);
create index agreements_status_idx   on agreements (status);

-- ---------------------------------------------------------------------------
-- agreement_tokens
-- Only the SHA-256 of the token is stored, so a table leak yields no usable
-- links. Lookup is by hash; plaintext never reaches the database.
-- ---------------------------------------------------------------------------
create table agreement_tokens (
  token_hash   text primary key,
  agreement_id uuid not null references agreements(id) on delete cascade,
  channel      delivery_channel not null,
  sent_to      text not null,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index agreement_tokens_agreement_idx on agreement_tokens (agreement_id);

-- ---------------------------------------------------------------------------
-- signatures
-- The evidentiary record. Under ESIGN/UETA enforceability comes from the trail
-- around the signature, not the mark itself.
-- ---------------------------------------------------------------------------
create table signatures (
  id               uuid primary key default gen_random_uuid(),
  agreement_id     uuid not null unique references agreements(id) on delete cascade,

  signer_name      text not null,
  signer_title     text,

  -- The six field values exactly as submitted, including any edits the signer
  -- made to the prefill. This is what gets stamped into the PDF.
  submitted_fields jsonb not null,

  signature_value  text not null,
  signature_kind   text not null check (signature_kind in ('typed', 'drawn')),

  -- Consent to transact electronically: its own affirmative act, its own
  -- timestamp, distinct from the signature.
  esign_consent_at timestamptz not null,

  -- Tamper evidence: SHA-256 over template_version plus canonical field values.
  doc_sha256       text not null,

  ip               inet,
  user_agent       text,
  channel          delivery_channel not null,

  signed_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- delivery_log
-- ---------------------------------------------------------------------------
create table delivery_log (
  id                  uuid primary key default gen_random_uuid(),
  agreement_id        uuid not null references agreements(id) on delete cascade,
  channel             delivery_channel not null,
  provider            text not null,
  provider_message_id text,
  status              text not null,
  error               text,
  created_at          timestamptz not null default now()
);

create index delivery_log_agreement_idx on delivery_log (agreement_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger agreements_touch
  before update on agreements
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- is_tailgate_rep(): true for the Payout Pro super-admin, so the admin can read
-- every agreement while ordinary reps see only their own (created_by). Payout
-- Pro's admin is a single hardcoded email; the check reads it off the JWT.
-- ---------------------------------------------------------------------------
create or replace function is_tailgate_rep() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'shuffman@tailgateofficial.com';
$$;

-- ---------------------------------------------------------------------------
-- RLS: deny by default.
--
-- The Vite app is a browser bundle, so it can only ever hold the anon key.
-- Every privileged operation goes through an Edge Function holding the service
-- role key. These policies only govern what a signed-in rep can READ directly
-- from the browser client.
--
-- Payout Pro has no org_members table. Reps are employees in the app_data JSON
-- blob 'po_emp' (matched by email); there is no per-row rep table to join. So
-- direct browser reads are scoped to the agreement's creator: created_by is
-- stamped with the rep's auth.uid() at insert (see the app's creation path,
-- §3.6). This agrees with requireRep() in _shared/context.ts, which gates
-- CREATION to roster emails; a rep then reads back only what they created.
-- agreement_tokens and delivery_log stay Edge-Function-only (no policies).
-- ---------------------------------------------------------------------------
alter table agreements       enable row level security;
alter table agreement_tokens enable row level security;
alter table signatures       enable row level security;
alter table delivery_log     enable row level security;

create policy agreements_read on agreements
  for select to authenticated
  using (created_by = auth.uid() or is_tailgate_rep());

-- Reps create their own draft agreements directly from the call screen (§3.6).
-- created_by defaults to auth.uid(); the check pins it to the caller so a rep
-- cannot insert rows owned by someone else. Sending/signing still go through the
-- service-role Edge Functions.
create policy agreements_insert on agreements
  for insert to authenticated
  with check (created_by = auth.uid());

create policy signatures_read on signatures
  for select to authenticated
  using (is_tailgate_rep() or exists (
    select 1 from agreements a
    where a.id = signatures.agreement_id and a.created_by = auth.uid()
  ));

-- agreement_tokens and delivery_log get no policies at all. Edge Functions
-- only.

-- ---------------------------------------------------------------------------
-- Realtime: powers the live status on the rep call screen.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table agreements;
