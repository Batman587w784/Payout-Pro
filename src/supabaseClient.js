import { createClient } from '@supabase/supabase-js';

// Single shared Supabase client. App.jsx and the e-signature components
// (AgreementPanel) both import this so there is exactly one auth instance.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
