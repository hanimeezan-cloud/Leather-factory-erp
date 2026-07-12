export type AuthMode = "demo" | "supabase";

const requestedAuthMode = (import.meta.env.VITE_AUTH_MODE as string | undefined)?.toLowerCase();

export const authMode: AuthMode = requestedAuthMode === "supabase" ? "supabase" : "demo";

export const isDemoMode = authMode === "demo";

export const supabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  passwordResetRedirectUrl: import.meta.env.VITE_SUPABASE_PASSWORD_RESET_REDIRECT_URL as
    | string
    | undefined,
};

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

export function getSupabaseConfigError() {
  if (authMode !== "supabase") return null;
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return "Supabase Auth mode is enabled, but VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not configured in .env.";
  }
  return null;
}

export function getPasswordResetRedirectUrl() {
  if (supabaseConfig.passwordResetRedirectUrl) {
    return supabaseConfig.passwordResetRedirectUrl;
  }

  if (typeof window === "undefined") return "/login?reset=1";
  return `${window.location.origin}/login?reset=1`;
}
