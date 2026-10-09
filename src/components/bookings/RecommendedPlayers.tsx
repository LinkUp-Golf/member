"use client";

// The players from the booker's recent cancelled rounds, offered on a round
// they've booked since. "Ping" messages them to come and book; "Add" puts them
// on this booking outright (when the group has room) and messages them that it
// did. See src/lib/bookings/recommended-players.ts for who is recommended and
// why pings are capped at the day's open spots.

import { useEffect, useState } from "react";
import Image from "next/image";
import { Spinner } from "@/components/ui/Loading";
import { nameOrEmail } from "@/lib/utils";
import type { RecommendedPlayer } from "@/lib/bookings/recommended-players";
import type { Booking } from "@/types";

interface Props {
  bookingId: string;
  /** Whether the group has room to add someone outright. */
  canAdd: boolean;
  onPlayersAdded: (rows: Booking[]) => void;
}

export default function RecommendedPlayers({ bookingId, canAdd, onPlayersAdded }: Props) {
  const [players, setPlayers] = useState<RecommendedPlayer[]>([]);
  const [pingsLeft, setPingsLeft] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookings/${bookingId}/recommended-players`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setPlayers(data.players ?? []);
        setPingsLeft(data.pingsLeft ?? 0);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (!loaded || players.length === 0) return null;

  function markSent(memberId: string, kind: "ping" | "invite") {
    setPlayers((prev) => prev.map((p) => (p.memberId === memberId ? { ...p, pinged: kind } : p)));
  }

  async function message(memberId: string, action: "ping" | "invite"): Promise<boolean> {
    const res = await fetch(`/api/bookings/${bookingId}/recommended-players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, action }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      setError(data?.error ?? "Couldn't send that. Please try again.");
      return false;
    }
    if (typeof data.pingsLeft === "number") setPingsLeft(data.pingsLeft);
    markSent(memberId, action);
    return true;
  }

  async function ping(p: RecommendedPlayer) {
    setBusy(p.memberId);
    setError("");
    await message(p.memberId, "ping");
    setBusy(null);
  }

  async function add(p: RecommendedPlayer) {
    setBusy(p.memberId);
    setError("");
    try {
      const res = await fetch(`/api/bookings/${bookingId}/players`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A member's address and phone are read from their row server-side.
        body: JSON.stringify({
          additionalPlayers: [
            { memberId: p.memberId, firstName: p.firstName, lastName: p.lastName, email: "", mobile: "" },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't add them. Please try again.");
        return;
      }
      onPlayersAdded(Array.isArray(data.bookings) ? (data.bookings as Booking[]) : []);
      await message(p.memberId, "invite");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-4 py-3 border-t" style={{ borderColor: "rgba(0,38,105,0.06)" }}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-xs font-semibold" style={{ color: "var(--color-green-900)" }}>
          Players who cancelled — invite them back
        </p>
        <p className="text-[11px] tabular-nums" style={{ color: "rgba(0,38,105,0.45)" }}>
          {pingsLeft === 0 ? "No spots left to ping" : `${pingsLeft} ping${pingsLeft === 1 ? "" : "s"} left`}
        </p>
      </div>
      <ul className="space-y-2">
        {players.map((p) => {
          const name = nameOrEmail(`${p.firstName} ${p.lastName}`, p.labelEmail) || "Member";
          const isBusy = busy === p.memberId;
          return (
            <li key={p.memberId} className="flex items-center gap-2.5">
              <div className="relative w-8 h-8 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-xs font-bold"
                style={{ background: "rgba(133,187,101,0.15)", color: "var(--color-green-700)" }}>
                {p.avatarUrl ? (
                  <Image src={p.avatarUrl} alt="" fill className="object-cover" sizes="32px" />
                ) : (
                  (p.firstName[0] ?? name[0] ?? "?").toUpperCase()
                )}
              </div>
              <span className="flex-1 min-w-0 truncate text-sm" style={{ color: "var(--color-green-900)" }}>
                {name}
              </span>
              {p.pinged ? (
                <span className="text-[11px] font-semibold" style={{ color: "rgba(0,38,105,0.45)" }}>
                  {p.pinged === "invite" ? "Added · messaged" : "Pinged"}
                </span>
              ) : isBusy ? (
                <Spinner className="w-4 h-4" />
              ) : (
                <div className="flex gap-1.5">
                  {canAdd && (
                    <button
                      type="button"
                      onClick={() => add(p)}
                      disabled={busy !== null}
                      className="px-2.5 py-1 rounded-full text-[11px] font-semibold border disabled:opacity-40"
                      style={{ borderColor: "rgba(0,38,105,0.15)", color: "var(--color-green-700)" }}
                    >
                      Add
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => ping(p)}
                    disabled={busy !== null || pingsLeft === 0}
                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-green-700)", color: "white" }}
                  >
                    Ping
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="mt-2 text-xs" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      )}
    </div>
  );
}
