import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * The Vite app runs on its own origin and calls these functions on
 * *.supabase.co, so every response needs CORS headers and every function needs
 * an OPTIONS preflight branch. This is the piece that most often gets missed
 * when moving route handlers to Edge Functions.
 *
 * Tighten ALLOWED_ORIGIN to the real app domain before production.
 */
const ALLOWED_ORIGIN = Deno.env.get("APP_URL") ?? "*";

export const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function preflight(): Response {
  return new Response("ok", { headers: corsHeaders });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Service-role client.
 *
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically into
 * every Edge Function. This key bypasses RLS, which is exactly why this code
 * lives here and not in the Vite bundle: anything in src/ ships to the browser.
 */
export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Authorization, not authentication.
 *
 * verify_jwt already guarantees the caller is signed in. This confirms they are
 * actually a Payout Pro rep, so an ordinary authenticated user cannot fire off
 * agreements.
 *
 * Payout Pro has no org_members table. Reps are employees stored as a JSON blob
 * in app_data (key 'po_emp'), matched to auth.users by email; the admin is a
 * single hardcoded email. A "rep" here is: the admin, or anyone whose login
 * email is on the po_emp roster. This is the same identity the RLS policies key
 * off (via created_by), so the two agree.
 */
const ADMIN_EMAIL = "shuffman@tailgateofficial.com";

export async function requireRep(
  req: Request,
): Promise<{ id: string; email: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await anon.auth.getUser();
  if (error || !user?.email) return null;
  const email = user.email.toLowerCase();

  if (email === ADMIN_EMAIL) return { id: user.id, email };

  const db = serviceClient();
  const { data: row } = await db
    .from("app_data")
    .select("value")
    .eq("key", "po_emp")
    .maybeSingle();

  let roster: Array<{ email?: string }> = [];
  try {
    roster = JSON.parse(row?.value ?? "[]");
  } catch {
    roster = [];
  }
  const onRoster = Array.isArray(roster) &&
    roster.some((e) => (e?.email ?? "").toLowerCase() === email);

  return onRoster ? { id: user.id, email } : null;
}
