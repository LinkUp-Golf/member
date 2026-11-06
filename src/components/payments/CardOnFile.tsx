"use client";

// The card a late cancellation is charged to — shown when there is one, entered
// when there isn't.
//
// Entry is Stripe's Payment Element against a SetupIntent (POST
// /api/payments/card/setup), confirmed in place with redirect: 'if_required' so
// the member stays on the screen they were on — the booking they're halfway
// through included. A bank that insists on a full-page 3-D Secure redirect is
// the exception, and the webhook saves the card for that case. Nothing is
// charged here.
//
// Edit is that same form again: Stripe never lets a card's number be changed,
// so the new card replaces the old one. Remove asks first and can be refused
// (DELETE /api/payments/card) while the card is guaranteeing an upcoming round;
// the refusal's message says why, and Edit is the way through it.
//
// Loading is drawn as skeletons in the shape of what's coming, never a spinner.

import { useEffect, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Appearance } from "@stripe/stripe-js";
import { Skeleton, Spinner } from "@/components/ui/Loading";
import { getBrowserStripe } from "@/lib/stripe/browser";
import { useStripePublishableKey } from "@/components/providers/StripeKeyProvider";
import { cardExpiry, cardLabel, type SavedCard } from "@/lib/stripe/card";

const APPEARANCE: Appearance = {
  theme: "stripe",
  variables: {
    colorPrimary: "#002669",
    colorText: "#002669",
    colorDanger: "#dc2626",
    borderRadius: "12px",
    fontSizeBase: "15px",
  },
};

const SAVED_CARD_BOX = {
  background: "rgba(0,38,105,0.03)",
  border: "1px solid rgba(0,38,105,0.08)",
};

/** The saved card's box, while the card is still loading. */
export function CardOnFileSkeleton() {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
      style={SAVED_CARD_BOX}
      aria-busy="true"
      aria-label="Loading card"
    >
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

/** The Payment Element's shape — card number, then expiry and CVC — and the save button. */
function CardFormSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading card form">
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      </div>
      <Skeleton className="h-11 w-full rounded-2xl" />
    </div>
  );
}

export default function CardOnFile({
  card,
  onSaved,
  onRemoved,
  compact = false,
}: {
  card: SavedCard | null;
  onSaved: (card: SavedCard) => void;
  /** Offers Remove; called once the card is gone. */
  onRemoved?: () => void;
  /** Tighter copy, for inside another form (the booking confirm screen). */
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");

  async function remove() {
    setRemoving(true);
    setRemoveError("");
    try {
      const res = await fetch("/api/payments/card", { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRemoveError(json.error ?? "We couldn’t remove that card. Try again.");
        setConfirmingRemove(false);
        return;
      }
      setConfirmingRemove(false);
      onRemoved?.();
    } catch {
      setRemoveError("Network error. Check your connection and try again.");
    } finally {
      setRemoving(false);
    }
  }

  if (card && !editing) {
    return (
      <div className="space-y-2">
        <div
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
          style={SAVED_CARD_BOX}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--color-green-900)" }}>
              {cardLabel(card)}
            </p>
            {cardExpiry(card) && (
              <p className="text-xs mt-0.5" style={{ color: "rgba(0,38,105,0.45)" }}>
                {cardExpiry(card)}
              </p>
            )}
          </div>
          {confirmingRemove ? (
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className="text-xs" style={{ color: "rgba(0,38,105,0.55)" }}>
                Remove?
              </span>
              <button
                type="button"
                onClick={remove}
                disabled={removing}
                className="text-xs font-semibold disabled:opacity-50"
                style={{ color: "rgb(185,28,28)" }}
              >
                {removing ? "Removing…" : "Remove"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                disabled={removing}
                className="text-xs font-semibold disabled:opacity-50"
                style={{ color: "rgba(0,38,105,0.5)" }}
              >
                Keep
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setRemoveError("");
                  setEditing(true);
                }}
                className="text-xs font-semibold"
                style={{ color: "var(--color-green-600)" }}
              >
                Edit
              </button>
              {onRemoved && (
                <button
                  type="button"
                  onClick={() => {
                    setRemoveError("");
                    setConfirmingRemove(true);
                  }}
                  className="text-xs font-semibold"
                  style={{ color: "rgba(220,38,38,0.75)" }}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
        {removeError && <p className="text-xs text-red-600">{removeError}</p>}
      </div>
    );
  }

  return (
    <CardForm
      compact={compact}
      onCancel={card ? () => setEditing(false) : undefined}
      onSaved={(saved) => {
        setEditing(false);
        onSaved(saved);
      }}
    />
  );
}

function CardForm({
  compact,
  onSaved,
  onCancel,
}: {
  compact: boolean;
  onSaved: (card: SavedCard) => void;
  onCancel?: () => void;
}) {
  const publishableKey = useStripePublishableKey();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/payments/card/setup", { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && typeof json.clientSecret === "string") setClientSecret(json.clientSecret);
        else setError(json.error ?? "We couldn’t load the card form. Try again.");
      } catch {
        if (!cancelled) setError("Network error. Check your connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error && !clientSecret) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!clientSecret) return <CardFormSkeleton />;

  return (
    <Elements stripe={getBrowserStripe(publishableKey)} options={{ clientSecret, appearance: APPEARANCE }}>
      <CardFormInner compact={compact} onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}

function CardFormInner({
  compact,
  onSaved,
  onCancel,
}: {
  compact: boolean;
  onSaved: (card: SavedCard) => void;
  onCancel?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The Payment Element is an iframe that paints a beat after it mounts.
  const [ready, setReady] = useState(false);

  // A button, not a form submit: on the confirm screen this sits inside the
  // booking form, and a nested submit would send the booking instead.
  async function save() {
    if (!stripe || !elements) return;
    setSaving(true);
    setError("");
    try {
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.href },
      });
      if (confirmError) {
        setError(confirmError.message ?? "That card couldn’t be saved.");
        return;
      }
      if (!setupIntent || setupIntent.status !== "succeeded") {
        setError("That card couldn’t be saved. Try another.");
        return;
      }
      const res = await fetch("/api/payments/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupIntentId: setupIntent.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.card) {
        setError(json.error ?? "We couldn’t save that card. Try again.");
        return;
      }
      onSaved(json.card as SavedCard);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      {!ready && <CardFormSkeleton />}
      {/* Mounted from the start so it loads behind the skeleton; out of the
          flow until then so the two don't stack. */}
      <div
        className={
          ready
            ? "space-y-3"
            : "space-y-3 absolute inset-x-0 top-0 opacity-0 pointer-events-none"
        }
        aria-hidden={!ready}
      >
        <PaymentElement
          options={{ layout: "tabs" }}
          onReady={() => setReady(true)}
          onLoadError={() => {
            setError("We couldn’t load the card form. Try again.");
            setReady(true);
          }}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!stripe || !ready || saving}
            className="btn btn-primary flex-1 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Spinner className="w-4 h-4" /> Saving…
              </>
            ) : (
              "Save card"
            )}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="text-sm px-3"
              style={{ color: "rgba(0,38,105,0.5)" }}
            >
              Cancel
            </button>
          )}
        </div>
        {!compact && (
          <p className="text-xs" style={{ color: "rgba(0,38,105,0.4)" }}>
            Saving a card charges nothing. It’s only used if you cancel a round late.
          </p>
        )}
      </div>
    </div>
  );
}
