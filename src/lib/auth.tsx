import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Profile } from "./domain";
import {
  authenticateDemoUser,
  ensureDemoData,
  getCurrentDemoProfile,
  setDemoSession,
} from "./demo-data";
import { apiRequest } from "./api-client";
import { authMode, getSupabaseConfigError, isDemoMode, type AuthMode } from "./app-config";
import { getSupabaseClient } from "./supabase";

// DEMO ONLY path remains available when VITE_AUTH_MODE=demo.
// Production/pilot auth path is Supabase Auth when VITE_AUTH_MODE=supabase.

interface AuthContextValue {
  user: { id: string; email: string } | null;
  session: { userId: string } | null;
  profile: Profile | null;
  isLoading: boolean;
  authMode: AuthMode;
  isDemoMode: boolean;
  configError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function profileToUser(profile: Profile | null) {
  return profile ? { id: profile.userId, email: profile.email } : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(() => getSupabaseConfigError());

  const refreshProfile = useCallback(async () => {
    if (isDemoMode) {
      setProfile(getCurrentDemoProfile());
      return;
    }

    const error = getSupabaseConfigError();
    setConfigError(error);
    if (error) {
      setProfile(null);
      return;
    }

    setProfile(await apiRequest<Profile>("/me"));
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadInitialSession() {
      if (isDemoMode) {
        ensureDemoData();
        if (alive) {
          setProfile(getCurrentDemoProfile());
          setIsLoading(false);
        }
        return;
      }

      const error = getSupabaseConfigError();
      setConfigError(error);
      if (error) {
        if (alive) {
          setProfile(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        if (data.session) {
          setProfile(await apiRequest<Profile>("/me"));
        } else {
          setProfile(null);
        }
      } catch (error) {
        if (alive) {
          setProfile(null);
          setConfigError((error as Error).message);
        }
      } finally {
        if (alive) setIsLoading(false);
      }
    }

    void loadInitialSession();

    if (isDemoMode || getSupabaseConfigError()) {
      return () => {
        alive = false;
      };
    }

    const {
      data: { subscription },
    } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setProfile(null);
        return;
      }
      apiRequest<Profile>("/me")
        .then((nextProfile) => setProfile(nextProfile))
        .catch((error) => {
          setProfile(null);
          setConfigError((error as Error).message);
        });
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (isDemoMode) {
      const nextProfile = authenticateDemoUser(email, password);
      if (!nextProfile) {
        throw new Error("Invalid demo email or password.");
      }
      setProfile(nextProfile);
      return;
    }

    const error = getSupabaseConfigError();
    setConfigError(error);
    if (error) throw new Error(error);

    const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      throw new Error(signInError.message);
    }

    setProfile(await apiRequest<Profile>("/me"));
  }, []);

  const signOut = useCallback(async () => {
    if (isDemoMode) {
      setDemoSession(null);
      setProfile(null);
      return;
    }

    if (!getSupabaseConfigError()) {
      await getSupabaseClient().auth.signOut();
    }
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({
      user: profileToUser(profile),
      session: profile ? { userId: profile.userId } : null,
      profile,
      isLoading,
      authMode,
      isDemoMode,
      configError,
      signIn,
      refreshProfile,
      signOut,
    }),
    [configError, isLoading, profile, refreshProfile, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
