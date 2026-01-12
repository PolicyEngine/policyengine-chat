"use client";

import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--color-surface)]" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("reset") === "true") {
      setIsResetPassword(true);
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isResetPassword && !email.trim()) return;
    if (!isForgotPassword && !password.trim()) return;

    setIsLoading(true);
    setMessage(null);

    if (isResetPassword) {
      const { error } = await supabase.auth.updateUser({ password: password.trim() });
      if (error) {
        setMessage({ type: "error", text: error.message });
      } else {
        setMessage({ type: "success", text: "Password updated successfully!" });
        setIsResetPassword(false);
        router.push("/");
      }
    } else if (isForgotPassword) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/login`,
      });

      if (error) {
        setMessage({ type: "error", text: error.message });
      } else {
        setMessage({ type: "success", text: "Check your email for a password reset link." });
      }
    } else if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password.trim(),
      });

      if (error) {
        setMessage({ type: "error", text: error.message });
      } else {
        setMessage({ type: "success", text: "Account created! You can now sign in." });
        setIsSignUp(false);
        setPassword("");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });

      if (error) {
        setMessage({ type: "error", text: error.message });
      } else {
        router.push("/");
      }
    }
    setIsLoading(false);
  }

  return (
    <div className="min-h-screen bg-[var(--color-surface)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[var(--color-pe-green)] flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white font-bold text-xl">PE</span>
          </div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            PolicyEngine Chat
          </h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-2">
            AI-powered tax and benefit policy analysis
          </p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl border border-[var(--color-border)] p-6 shadow-sm">
          <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-4">
            {isResetPassword ? "Set new password" : isForgotPassword ? "Reset password" : isSignUp ? "Create an account" : "Sign in"}
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              {!isResetPassword && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={isLoading}
                    className="w-full px-4 py-2.5 text-sm border border-[var(--color-border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-pe-green)] focus:border-transparent disabled:opacity-50 placeholder:text-[var(--color-text-muted)]"
                  />
                </div>
              )}

              {!isForgotPassword && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isResetPassword ? "Enter new password (min 6 chars)" : isSignUp ? "Choose a password (min 6 chars)" : "Your password"}
                    disabled={isLoading}
                    className="w-full px-4 py-2.5 text-sm border border-[var(--color-border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-pe-green)] focus:border-transparent disabled:opacity-50 placeholder:text-[var(--color-text-muted)]"
                  />
                </div>
              )}
            </div>

            {!isSignUp && !isForgotPassword && !isResetPassword && (
              <button
                type="button"
                onClick={() => {
                  setIsForgotPassword(true);
                  setMessage(null);
                }}
                className="mt-2 text-sm text-[var(--color-pe-green)] hover:text-[var(--color-pe-green-dark)]"
              >
                Forgot password?
              </button>
            )}

            <button
              type="submit"
              disabled={isLoading || (!isResetPassword && !email.trim()) || (!isForgotPassword && !password.trim())}
              className="w-full mt-5 px-4 py-2.5 bg-[var(--color-pe-green)] hover:bg-[var(--color-pe-green-dark)] text-white rounded-xl text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? "Loading..." : isResetPassword ? "Update password" : isForgotPassword ? "Send reset link" : isSignUp ? "Create account" : "Sign in"}
            </button>
          </form>

          {/* Message */}
          {message && (
            <div
              className={`mt-4 p-3 rounded-lg text-sm ${
                message.type === "success"
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}
            >
              {message.text}
            </div>
          )}

          {/* Toggle sign up / sign in / forgot password */}
          {!isResetPassword && (
            <div className="mt-5 pt-5 border-t border-[var(--color-border)] text-center">
              {isForgotPassword ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotPassword(false);
                    setMessage(null);
                  }}
                  className="text-sm text-[var(--color-pe-green)] hover:text-[var(--color-pe-green-dark)] font-medium"
                >
                  Back to sign in
                </button>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">
                  {isSignUp ? "Already have an account?" : "Don't have an account?"}
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignUp(!isSignUp);
                      setMessage(null);
                    }}
                    className="ml-1 text-[var(--color-pe-green)] hover:text-[var(--color-pe-green-dark)] font-medium"
                  >
                    {isSignUp ? "Sign in" : "Sign up"}
                  </button>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[var(--color-text-muted)] mt-6">
          By signing in, you agree to our terms of service
        </p>
      </div>
    </div>
  );
}
