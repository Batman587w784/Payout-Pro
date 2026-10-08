-- Let the Tailgate super-admin READ the agreement delivery trail from the browser.
--
-- agreement_tokens and delivery_log were originally Edge-Function-only (no policies at all),
-- which is why the admin screen can't show "who this agreement was actually sent to".
-- These are SELECT-only policies gated on is_tailgate_rep(), so the admin can verify that a
-- rep texted/emailed the link to the merchant and not to themselves. Writes stay service-role
-- only — nothing here lets the browser mint or alter a token.

create policy agreement_tokens_read_admin on agreement_tokens
  for select to authenticated
  using (is_tailgate_rep());

create policy delivery_log_read_admin on delivery_log
  for select to authenticated
  using (is_tailgate_rep());
