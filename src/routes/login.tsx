import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { getPasswordResetRedirectUrl } from "@/lib/app-config";
import { getSupabaseClient } from "@/lib/supabase";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login - Footwear Production Hub" },
      { name: "description", content: "Sign in to Footwear Production Hub." },
    ],
  }),
  component: LoginPage,
});

function safeInternalRedirect(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function LoginPage() {
  const { user, signIn, isDemoMode, configError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      window.location.hash.includes("type=recovery") || window.location.search.includes("reset=1")
    );
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const resetRedirectUrl = useMemo(() => getPasswordResetRedirectUrl(), []);

  const redirectTo = useMemo(() => {
    if (typeof window === "undefined") return "/";
    return safeInternalRedirect(new URLSearchParams(window.location.search).get("redirect"));
  }, []);

  useEffect(() => {
    if (user && !isPasswordRecovery) {
      window.location.assign(redirectTo);
    }
  }, [isPasswordRecovery, redirectTo, user]);

  useEffect(() => {
    if (isDemoMode || configError) return;
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    const search = typeof window === "undefined" ? "" : window.location.search;
    if (hash.includes("type=recovery") || search.includes("reset=1")) {
      setIsPasswordRecovery(true);
      setResetMessage("Enter a new password for your Supabase account.");
    }

    const {
      data: { subscription },
    } = getSupabaseClient().auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "USER_UPDATED") {
        console.info("[Supabase Auth] Auth event on login page:", event);
      }
      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
        setResetMessage("Enter a new password for your Supabase account.");
      }
    });
    return () => subscription.unsubscribe();
  }, [configError, isDemoMode]);

  const submit = async () => {
    if (configError) {
      toast.error(configError);
      return;
    }
    if (!email.trim()) {
      toast.error("Enter your email address.");
      return;
    }
    if (!password) {
      toast.error("Enter your password.");
      return;
    }

    setIsSubmitting(true);
    try {
      await signIn(email, password);
      window.location.assign(redirectTo);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendReset = async () => {
    if (isDemoMode) {
      toast.info("Demo mode uses fixed seeded passwords for the meeting.");
      return;
    }

    if (configError) {
      toast.error(configError);
      return;
    }

    if (!email.trim()) {
      toast.error("Enter your email address first.");
      return;
    }

    setIsResetting(true);
    try {
      console.info("[Supabase Auth] Requesting password reset email.", {
        email,
        redirectTo: resetRedirectUrl,
      });
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: resetRedirectUrl,
      });
      if (error) {
        console.warn("[Supabase Auth] Password reset request failed.", {
          message: error.message,
          name: error.name,
          status: "status" in error ? error.status : undefined,
        });
        throw new Error(error.message);
      }
      console.info("[Supabase Auth] Password reset request accepted.", {
        redirectTo: resetRedirectUrl,
      });
      const message =
        "Password reset email requested. If no email arrives, configure Supabase Auth SMTP and allow this redirect URL: " +
        resetRedirectUrl;
      setResetMessage(message);
      toast.success("Password reset email requested.");
    } catch (error) {
      const message = `${(error as Error).message}. Check Supabase Auth SMTP and redirect URL settings.`;
      setResetMessage(message);
      toast.error(message);
    } finally {
      setIsResetting(false);
    }
  };

  const updatePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("Enter a new password with at least 6 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      console.info("[Supabase Auth] Updating password from recovery session.");
      const { error } = await getSupabaseClient().auth.updateUser({ password: newPassword });
      if (error) {
        console.warn("[Supabase Auth] Password update failed.", {
          message: error.message,
          name: error.name,
          status: "status" in error ? error.status : undefined,
        });
        throw new Error(error.message);
      }
      console.info("[Supabase Auth] Password updated successfully.");
      toast.success("Password updated. Please sign in again.");
      await getSupabaseClient().auth.signOut();
      setIsPasswordRecovery(false);
      setNewPassword("");
      setPassword("");
      window.history.replaceState(null, "", "/login");
    } catch (error) {
      const message = `${(error as Error).message}. Open the latest password reset link from your email and make sure Supabase redirect URLs include this app.`;
      setResetMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Footwear Production Hub</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isDemoMode ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
              Demo Mode - sample data. Use one of the seeded factory users.
            </div>
          ) : configError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {configError}
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Sign in with your factory Supabase account.
            </div>
          )}
          {resetMessage ? (
            <div className="rounded-md border border-info/30 bg-info/10 p-3 text-sm text-info-foreground">
              {resetMessage}
            </div>
          ) : null}
          {isPasswordRecovery && !isDemoMode ? (
            <div className="grid gap-3 rounded-md border border-border p-3">
              <div className="grid gap-1.5">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </div>
              <Button onClick={updatePassword} disabled={isSubmitting}>
                {isSubmitting ? "Updating..." : "Update Password"}
              </Button>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
          </div>
          <Button onClick={submit} disabled={isSubmitting || Boolean(configError)}>
            Sign In
          </Button>
          <Button
            variant="ghost"
            onClick={sendReset}
            disabled={isResetting || Boolean(configError)}
          >
            {isDemoMode ? "Reset Password" : "Email Password Reset"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
