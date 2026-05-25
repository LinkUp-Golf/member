"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/Loading";
import { createClient } from "@/lib/supabase";

type State = "idle" | "loading" | "sent" | "error";

type GateResponse =
  | { returning: true; token_hash: string }
  | { allowed: boolean };

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("loading");

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const gateRes = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      if (!gateRes.ok) {
        const data = await gateRes.json().catch(() => ({}));
        setErrorMessage(
          (data as { error?: string }).error ??
            "Something went wrong. Please try again.",
        );
        setState("error");
        return;
      }

      const gate = (await gateRes.json()) as GateResponse;

      // Returning member — server generated a token silently, no email sent.
      // Verify it client-side to establish a session, then redirect.
      if ("returning" in gate && gate.returning) {
        const supabase = createClient();
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: gate.token_hash,
          type: "email",
        });
        if (verifyError) {
          setErrorMessage("Could not sign you in. Please try again.");
          setState("error");
          return;
        }
        router.replace(searchParams.get("redirectTo") ?? "/home");
        return;
      }

      // New user — not yet in members table.
      if (!gate.allowed) {
        // Generic response — do not reveal whether email exists in GHL.
        setState("sent");
        return;
      }

      // New member passed GHL gate — send magic link email.
      // Browser stores the PKCE code_verifier for the callback exchange.
      const supabase = createClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback`,
          shouldCreateUser: true,
        },
      });

      if (otpError) {
        setErrorMessage(
          otpError.message === "email rate limit exceeded"
            ? "Too many requests. Please wait a moment and try again."
            : "Failed to send login link. Please try again.",
        );
        setState("error");
        return;
      }

      setState("sent");
    } catch {
      setErrorMessage(
        "Unable to connect. Please check your connection and try again.",
      );
      setState("error");
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#002669" }}
    >
      <div className="flex-1 flex flex-col items-center justify-center px-8 pt-16 pb-8">
        {/* Logo */}
        <div className="mb-2 text-center">
          <div
            className="font-display text-5xl mb-1"
            style={{ color: "#85bb65" }}
          >
            LinkUp Golf
          </div>
          <div className="text-xs uppercase tracking-[0.2em] text-white/30">
            Member Portal
          </div>
        </div>

        <div
          className="w-12 h-px my-8"
          style={{ background: "rgba(133,187,101,0.3)" }}
        />

        {state === "sent" ? (
          <div className="text-center animate-fade-in">
            <div className="text-4xl mb-4">✉️</div>
            <h2 className="font-serif text-2xl text-white mb-3">
              Check your email
            </h2>
            <p className="text-sm text-white/50 leading-relaxed max-w-xs mx-auto">
              If your email address is registered with LinkUp Golf, you&apos;ll
              receive a login link shortly. Tap it to access your member portal.
            </p>
            <p className="text-xs text-white/25 mt-6">
              Didn&apos;t receive it? Check your spam folder or contact your
              LinkUp coordinator.
            </p>
            <button
              onClick={() => {
                setState("idle");
                setEmail("");
                setErrorMessage("");
              }}
              className="mt-6 text-xs underline text-white/30"
            >
              Try a different email
            </button>
          </div>
        ) : (
          <div className="w-full max-w-sm animate-fade-in">
            <h2 className="font-serif text-2xl text-white text-center mb-2">
              Sign in
            </h2>
            <p className="text-sm text-center text-white/40 mb-8">
              Enter your email to receive a secure login link. No password
              required.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                autoComplete="email"
                autoFocus
                required
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3.5 rounded-xl text-sm outline-none transition-colors"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  border: "0.5px solid rgba(255,255,255,0.12)",
                  color: "white",
                }}
                disabled={state === "loading"}
              />

              {state === "error" && (
                <p className="text-xs text-red-400 text-center">
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={state === "loading" || !email.trim()}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                style={{ background: "#85bb65", color: "#002669" }}
              >
                {state === "loading" ? (
                  <Spinner className="text-green-900" />
                ) : (
                  "Send login link"
                )}
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="px-8 pb-10 text-center">
        <p className="text-xs text-white/15 leading-relaxed">
          LinkUp Golf is a private, invitation-only community.
          <br />
          Membership by referral only.
        </p>
      </div>
    </div>
  );
}
