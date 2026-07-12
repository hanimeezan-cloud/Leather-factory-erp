import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfigError, supabaseConfig } from "./app-config";

let client: SupabaseClient | null = null;

export function getSupabaseClient() {
  const configError = getSupabaseConfigError();
  if (configError) {
    throw new Error(configError);
  }

  if (!client) {
    client = createClient(supabaseConfig.url ?? "", supabaseConfig.anonKey ?? "", {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }

  return client;
}
