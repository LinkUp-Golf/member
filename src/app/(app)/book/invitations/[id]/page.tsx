"use client";

// An added player's invitation to a round: what it is, when, who invited them
// and who's paying — and Accept / Decline while it can still be answered.
// The rules are in @/lib/bookings/invitations; the data is
// GET/POST /api/bookings/[id]/invitation.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import AppShell from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui/Loading";
import WhatHappensNext from "@/components/booking/WhatHappensNext";
import { formatTeeTime } from "@/lib/utils";
import { paidByLabel, type InviteResponse, type InviteStatus } from "@/lib/bookings/invitations";

interface Invitation {
  id: string;
  eventName: string;
  location: string | null;
  bookingDate: string;
  teeTime: string;
  bookerName: string;
  paidByBooker: boolean;
  inviteStatus: InviteStatus | null;
  bookingStatus: string;
  canRespond: boolean;
}

export default function InvitationPage({ params }: { params: { id: string } }) {
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [answering, setAnswering] = useState<InviteResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bookings/${params.id}/invitation`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "We couldn't find this invitation.");
        setInvite(null);
      } else {
        setInvite(json as Invitation);
        setError("");
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(response: InviteResponse) {
    setAnswering(response);
    setError("");
    try {
      const res = await fetch(`/api/bookings/${params.id}/invitation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Something went wrong. Please try again.");
      await load();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setAnswering(null);
    }
  }

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="font-sans font-black text-2xl" style={{ color: "var(--color-gold)" }}>
              Invitation
            </div>
            <div className="logo-subtitle">You&apos;ve been added to a round</div>
          </div>
        </div>
      }
    >
      <div className="px-5 py-5 pb-8 space-y-5 md:max-w-2xl md:mx-auto">
        {loading && !invite ? (
          <div className="py-16 flex justify-center">
            <Spinner className="w-5 h-5 text-green-900" />
          </div>
        ) : !invite ? (
          <div className="card card-pad text-center">
            <p className="text-sm" style={{ color: "rgba(0,38,105,0.6)" }}>
              {error || "We couldn't find this invitation."}
            </p>
            <Link href="/book" className="btn btn-gold btn-full justify-center mt-4">
              Go to My Bookings
            </Link>
          </div>
        ) : (
          <>
            {/* The round */}
            <div className="card p-5">
              <p
                className="text-xs uppercase tracking-widest mb-3"
                style={{ color: "rgba(0,38,105,0.35)", letterSpacing: "0.12em" }}
              >
                {invite.bookerName} invited you
              </p>
              <p className="font-sans font-black text-2xl" style={{ color: "var(--color-green-900)" }}>
                {invite.eventName}
              </p>
              {invite.location && (
                <p className="text-xs mt-0.5" style={{ color: "rgba(0,38,105,0.45)" }}>
                  {invite.location}
                </p>
              )}
              <p className="text-sm mt-3" style={{ color: "rgba(0,38,105,0.7)" }}>
                {format(new Date(`${invite.bookingDate}T12:00:00`), "EEEE, MMMM d, yyyy")} ·{" "}
                {formatTeeTime(invite.teeTime)}
              </p>
              <div
                className="mt-3 pt-3 border-t text-sm font-medium"
                style={{
                  borderColor: "rgba(0,38,105,0.07)",
                  color: invite.paidByBooker ? "var(--color-green-700)" : "#92640a",
                }}
              >
                {invite.paidByBooker ? "✓ " : ""}
                {paidByLabel(invite.paidByBooker, invite.bookerName)}
              </div>
            </div>

            <WhatHappensNext paidByBooker={invite.paidByBooker} />

            {error && <p className="text-sm text-red-600">{error}</p>}

            {invite.canRespond ? (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => respond("decline")}
                  disabled={!!answering}
                  className="flex-1 py-3 rounded-2xl border text-sm font-semibold disabled:opacity-50"
                  style={{ borderColor: "rgba(0,38,105,0.15)", color: "rgba(0,38,105,0.7)" }}
                >
                  {answering === "decline" ? "Declining…" : "Decline"}
                </button>
                <button
                  type="button"
                  onClick={() => respond("accept")}
                  disabled={!!answering}
                  className="flex-1 btn btn-gold justify-center disabled:opacity-50"
                >
                  {answering === "accept" ? "Accepting…" : "Accept"}
                </button>
              </div>
            ) : (
              <div className="card card-pad text-center">
                <p className="text-sm font-semibold" style={{ color: "var(--color-green-900)" }}>
                  {invite.inviteStatus === "accepted"
                    ? "You're in — see you on the course."
                    : invite.inviteStatus === "declined"
                      ? `You declined. ${invite.bookerName} has been told.`
                      : "This invitation can no longer be answered."}
                </p>
                <Link href="/book" className="btn btn-gold btn-full justify-center mt-4">
                  Go to My Bookings
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
