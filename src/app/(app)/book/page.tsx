"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useForm, useFieldArray } from "react-hook-form";
import { useProfile } from "@/hooks/useProfile";
import { apiClient } from "@/lib/api-client";
import AppShell from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui/Loading";
import EmptyState from "@/components/ui/EmptyState";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageCircle, Star } from "lucide-react";
import { formatTeeTime, cn, bookingToLocalDate } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
import BookingSurveySheet, {
  type SurveyTarget,
} from "@/components/surveys/BookingSurveySheet";
import VenueAvailabilityCalendar, {
  type CalendarVenue,
  type CalendarOpening,
} from "@/components/calendar/VenueAvailabilityCalendar";
import {
  VENUE_DOT,
  buildVenueColours,
} from "@/components/calendar/venue-colours";
import VenueDayDetailSheet, {
  type VenueDayDetail,
} from "@/components/calendar/VenueDayDetailSheet";
import { isSurveyDue, SURVEYABLE_BOOKING_STATUSES } from "@/lib/surveys/due";
import {
  format,
  differenceInHours,
  startOfMonth,
} from "date-fns";
import type {
  Booking,
  GHLBookingSlot,
  AdditionalPlayer,
  MemberWithProfile,
  Course,
} from "@/types";
import {
  BOOKING_PRICE_USD,
  POLICY_TIERS,
  GHL_CANCEL_BOOKING_URL,
  AVIARA_TIMEZONE,
} from "@/lib/constants";
import { validateEmail } from "@/lib/validation";

type PlayerKind = "member" | "non_member";

// A phone number is required for non-member invites; keep the check lenient
// (digits/format vary) but reject obviously-too-short values.
function isValidGuestPhone(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length >= 7;
}

type Step = "select" | "confirm" | "success";

// FIFO payment gate: a member must resolve ALL unresolved (unpaid) bookings
// before creating another, at any course. A member can already have more
// than one — LinkUp is adding this rule to an app already in production, so
// existing accounts may carry several unresolved bookings from before the
// rule existed. Mirrors PendingPaymentBooking returned by
// GET /api/bookings/pending-payment and POST /api/bookings/create's 409.
interface PendingPayment {
  id: string;
  course_id: string;
  course_name: string;
  booking_date: string;
  tee_time: string;
  payment_url: string | null;
  status: string;
  player_name: string;
  target_member_id: string | null;
  invited: boolean;
  booker_name: string | null;
}

function formatSlotTime(isoString: string): string {
  return formatTeeTime(isoString.split("T")[1]?.slice(0, 8) ?? "");
}

export default function BookPage() {
  const { user } = useProfile();
  const searchParams = useSearchParams();
  const inviteMemberId = searchParams?.get("invite") ?? null;

  // What the member picked on the calendar. Venue, day and tee time arrive
  // together, so there is no partial selection to hold between screens.
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<GHLBookingSlot | null>(null);

  // Selected course (null = no course chosen yet)
  const [selectedEvent, setSelectedEvent] = useState<Course | null>(null);

  // Tee times always display in the *selected course's* own timezone — a tee
  // time is an appointment at that venue's local wall-clock time, regardless
  // of where the browsing member happens to be. Falls back to the legacy
  // single-venue default before a course has been chosen.
  const timezone = selectedEvent?.timezone ?? AVIARA_TIMEZONE;

  // Booking flow
  const [step, setStep] = useState<Step>("select");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmedBooking, setConfirmedBooking] = useState<{
    date: string;
    time: string;
    players: number;
    pendingNonMembers: number;
    bookingId: string | null;
    eventName: string;
  } | null>(null);

  // My bookings tab
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  // Guards against overlapping My-bookings refetches — like the pending list,
  // it's refreshed from several triggers (mount, tab focus/visibility) that can
  // fire near-simultaneously.
  const myBookingsRefreshInFlight = useRef(false);
  const [activeTab, setActiveTab] = useState<"book" | "myBookings">("book");
  // FIFO payment gate — every one of the member's bookings awaiting payment.
  // Starts loading=true (rather than assuming none) so the tee-time slot
  // list doesn't briefly render as bookable before the check resolves.
  const [pendingBookings, setPendingBookings] = useState<PendingPayment[]>([]);
  const [loadingPendingBookings, setLoadingPendingBookings] = useState(true);
  // Guards against overlapping pending-payment refetches — the banner is
  // refreshed from several triggers (mount, tab focus/visibility, a poll while
  // a payment is outstanding), which can fire near-simultaneously.
  const pendingRefreshInFlight = useRef(false);
  // Drives the disabled state of the banner's "Pay →" links while a
  // pending-payment refetch is in flight: the moment a member returns from the
  // checkout tab we're re-checking their status, so block a second tap until we
  // know whether that row has already cleared (guards against a double payment).
  const [refreshingPending, setRefreshingPending] = useState(false);

  useEffect(() => {
    if (user) loadMyBookings();
  }, [user]);
  useEffect(() => {
    if (user) loadPendingPayment();
  }, [user]);
  // Auto-refresh the FIFO payment list so a row drops off the banner/badge as
  // soon as its payment clears — without a manual reload, guarding against a
  // member paying twice on a stale banner. Payment happens on an external GHL
  // form (opened in a new tab via the "Pay →" link), and a GHL automation then
  // flips the booking's Supabase status availability_confirmed →
  // payment_confirmed out-of-band. The member returns to this tab afterward, so
  // refetch whenever it regains visibility/focus. The pending query is scoped
  // to status availability_confirmed, so a paid row simply stops coming back.
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState === "visible") loadPendingPayment();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [user]);
  // Mirror the pending-payment refetch for the My-bookings list: a booking's
  // status changes out-of-band too (payment clears, admin sets up a guest, a
  // cancellation lands), so refresh the list whenever the tab regains
  // visibility/focus rather than leaving it stale until a manual reload.
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState === "visible") loadMyBookings();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [user]);
  // The GHL status update is asynchronous, so it may land shortly AFTER the
  // member returns to this tab (when the focus refetch above already ran). While
  // a payment is still outstanding and the tab is visible, poll so the row also
  // delists on its own once the automation catches up — no tab-switch needed.
  useEffect(() => {
    if (!user || pendingBookings.length === 0) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadPendingPayment();
    }, 15000);
    return () => clearInterval(id);
  }, [user, pendingBookings.length]);
  async function loadMyBookings() {
    if (myBookingsRefreshInFlight.current) return;
    myBookingsRefreshInFlight.current = true;
    try {
      const response = await apiClient.get<Booking[]>("/api/bookings");
      // Keep the last-loaded list on a transient error so a background refresh
      // (focus/visibility) can't wipe the member's bookings on a network blip.
      if (response.data) setMyBookings(response.data);
    } finally {
      myBookingsRefreshInFlight.current = false;
    }
  }

  async function loadPendingPayment() {
    if (pendingRefreshInFlight.current) return;
    pendingRefreshInFlight.current = true;
    setRefreshingPending(true);
    try {
      const res = await fetch("/api/bookings/pending-payment");
      const data = await res.json();
      setPendingBookings(
        Array.isArray(data.pendingBookings) ? data.pendingBookings : [],
      );
    } catch {
      // Keep whatever we last loaded on a transient error — a background
      // refresh (focus/poll) must not wipe a real "payment due" banner on a
      // network blip (on the very first load the list is already empty). The
      // server still enforces the FIFO gate on /api/bookings/create regardless.
    } finally {
      pendingRefreshInFlight.current = false;
      setRefreshingPending(false);
      setLoadingPendingBookings(false);
    }
  }

  async function submitBooking(additionalPlayers: AdditionalPlayer[]) {
    if (!selectedSlot || !user || !selectedDate) return;
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/bookings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: selectedSlot.startTime,
          players: 1 + additionalPlayers.length,
          additionalPlayers,
          ...(selectedEvent ? { courseId: selectedEvent.id } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setConfirmedBooking({
          date: format(new Date(selectedDate + "T12:00:00"), "EEEE, MMMM d"),
          time: formatSlotTime(selectedSlot.startTime),
          players: 1 + additionalPlayers.length,
          pendingNonMembers:
            typeof data.pendingNonMembers === "number"
              ? data.pendingNonMembers
              : additionalPlayers.filter((p) => p.isNonMember).length,
          bookingId: typeof data.bookingId === "string" ? data.bookingId : null,
          eventName: selectedEvent?.name ?? "Park Hyatt Aviara",
        });
        if (Array.isArray(data.bookings)) {
          setMyBookings((prev) => [...(data.bookings as Booking[]), ...prev]);
        }
        setStep("success");
        // The calendar remounts when the success screen is dismissed and
        // refetches the month itself, so availability refreshes without a
        // second call from here.
        loadPendingPayment();
      } else {
        setError(data.error ?? "Something went wrong. Please try again.");
        // A 409 (FIFO gate) returns the bookings that blocked this attempt —
        // same upcoming-only scope the banner/badge use — so adopt them
        // directly to reflect the gate without an extra round-trip.
        if (Array.isArray(data.pendingBookings)) {
          setPendingBookings(data.pendingBookings);
        }
        // A 409 with seatsRemaining (daily cap reached) surfaces inline on the
        // confirm screen via `error`. Do NOT refresh the month slots here —
        // fetchMonthSlots() clears selectedSlot, which would bounce the member
        // back to date/event selection and lose their group. The daily cap
        // isn't reflected in per-slot availability anyway, so a refresh would
        // show nothing new.
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "success" && confirmedBooking) {
    return (
      <SuccessScreen
        booking={confirmedBooking}
        onDone={() => {
          setStep("select");
          setSelectedSlot(null);
          setSelectedEvent(null);
        }}
        onUpdateBooking={(bookingId, updates) =>
          setMyBookings((prev) =>
            prev.map((b) => (b.id === bookingId ? { ...b, ...updates } : b)),
          )
        }
      />
    );
  }

  if (step === "confirm" && selectedSlot && selectedDate) {
    return (
      <ConfirmScreen
        slot={selectedSlot}
        date={selectedDate}
        timezone={timezone}
        error={error}
        submitting={submitting}
        onSubmit={submitBooking}
        onBack={() => {
          setStep("select");
          setSelectedSlot(null);
          setSelectedEvent(null);
        }}
        inviteMemberId={inviteMemberId}
        bookerEmail={user?.email ?? ""}
        eventName={selectedEvent?.name ?? null}
      />
    );
  }

  return (
    <AppShell
      title="Book"
      description={selectedEvent ? selectedEvent.name : "Select an event"}
    >
      {/* Tabs */}
      <div
        className="flex border-b bg-white"
        style={{ borderColor: "rgba(0,38,105,0.07)" }}
      >
        {(["book", "myBookings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 py-3.5 text-sm font-medium transition-all border-b-2",
              activeTab === tab ? "border-green-900" : "border-transparent",
            )}
            style={{
              color:
                activeTab === tab
                  ? "var(--color-green-900)"
                  : "rgba(0,38,105,0.35)",
            }}
          >
            {tab === "book" ? "Book a round" : "My bookings"}
          </button>
        ))}
      </div>

      {activeTab === "book" ? (
        <EventSelectionScreen
          onSelect={(ev, date, slot) => {
            // Venue, day and tee time were all chosen on the calendar, so
            // there is nothing left to pick — go straight to confirmation.
            setSelectedEvent(ev);
            setSelectedDate(date);
            setSelectedSlot(slot);
            setError("");
            setStep("confirm");
          }}
          pendingBookings={pendingBookings}
          loadingPendingBookings={loadingPendingBookings}
          refreshingPending={refreshingPending}
        />
      ) : (
        <MyBookingsTab
          bookings={myBookings}
          onRefresh={loadMyBookings}
          onSwitchToBook={() => setActiveTab("book")}
          onUpdateBooking={(id, updates) =>
            setMyBookings((prev) =>
              prev.map((b) => (b.id === id ? { ...b, ...updates } : b)),
            )
          }
          onPlayersAdded={(rows) =>
            setMyBookings((prev) => [...rows, ...prev])
          }
        />
      )}
    </AppShell>
  );
}

// ---- FIFO payment gate banner ---------------------------------

function formatPendingDate(dateStr: string): string {
  return format(new Date(`${dateStr}T12:00:00`), "EEEE, MMMM d");
}

// Every entry here is, by construction, status === 'availability_confirmed'
// (see UNPAID_BOOKING_STATUSES) — the FIFO gate only ever flags rounds that
// are actually ready to be paid for, never ones still awaiting admin/GHL
// confirmation.
type PendingGroup = {
  course_name: string;
  booking_date: string;
  tee_time: string;
  // The querying member's own round in this group ("You"), when it's awaiting
  // payment. Present for both the booker's primary row and an invited player's
  // own row.
  self: PendingPayment | null;
  // Additional players in the same group whose rounds are also awaiting
  // payment. Only ever populated for the booker — an invited player's pending
  // list contains only their own row, so their group renders as `self` alone.
  others: PendingPayment[];
};

// A group booking is inserted as one row per player, each with its own GHL
// appointment moving through the payment pipeline independently — so the flat
// pending-payment list can carry several rows that belong to a single booked
// slot. Regroup them by course + date + tee time so the banner shows one card
// per booking: the booker sees their own round plus each additional player
// (with a "message" shortcut to nudge them), while an invited player sees only
// their own round.
function groupPendingPayments(pending: PendingPayment[]): PendingGroup[] {
  const bySlot = new Map<string, PendingPayment[]>();
  for (const p of pending) {
    const key = `${p.course_id}_${p.booking_date}_${p.tee_time}`;
    const rows = bySlot.get(key) ?? [];
    rows.push(p);
    bySlot.set(key, rows);
  }
  const groups: PendingGroup[] = [];
  for (const rows of bySlot.values()) {
    const first = rows[0];
    if (!first) continue;
    // "You" is the sanctioned marker the server sets for the querying member's
    // own round (booker primary row or invited-player row); everything else is
    // an additional player they booked.
    const self = rows.find((r) => r.player_name === "You") ?? null;
    groups.push({
      course_name: first.course_name,
      booking_date: first.booking_date,
      tee_time: first.tee_time,
      self,
      others: rows.filter((r) => r !== self),
    });
  }
  return groups;
}

function PendingPaymentBanner({
  pending,
  refreshing = false,
}: {
  pending: PendingPayment[];
  // True while the parent is re-checking the pending-payment list (e.g. right
  // after the member returns from the checkout tab). Disables the "Pay →" links
  // so a member can't fire a second payment before we know a row has cleared.
  refreshing?: boolean;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  // The member id whose "message" request is in flight, so only that button
  // shows a disabled/loading state.
  const [messagingId, setMessagingId] = useState<string | null>(null);
  const [messageError, setMessageError] = useState("");

  const groups = groupPendingPayments(pending);
  const current = groups[Math.min(index, groups.length - 1)];
  if (!current) return null;

  const hasMultiple = groups.length > 1;
  // The member's own round first (when present), then any additional players.
  const rows = [...(current.self ? [current.self] : []), ...current.others];
  const soleName =
    rows.length === 1
      ? rows[0]?.player_name === "You"
        ? "your"
        : `${rows[0]?.player_name}'s`
      : null;
  // When the querying member is an invited player (added to someone else's
  // booking), the banner explains they were invited and owe their share,
  // instead of the booker-facing wording. An invited player only ever has
  // their own single row, so this reads off the group's `self` row.
  const invited = current.self?.invited ?? false;
  const bookerName = current.self?.booker_name ?? null;

  async function messageMember(memberId: string) {
    setMessagingId(memberId);
    setMessageError("");
    const res = await apiClient.post<{ id: string }>("/api/conversations", {
      type: "direct",
      participant_ids: [memberId],
    });
    setMessagingId(null);
    if (res.error || !res.data) {
      setMessageError(res.error?.message ?? "Couldn't open the conversation.");
      return;
    }
    router.push(`/messages/${res.data.id}`);
  }

  return (
    <div
      className="mx-5 md:mx-8 mt-3 px-4 py-3 rounded-2xl border"
      style={{
        background: "rgba(146,100,10,0.06)",
        borderColor: "rgba(146,100,10,0.25)",
      }}
    >
      <div className="flex items-start gap-3">
        <span className="text-lg leading-none mt-0.5">💳</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold" style={{ color: "#92640a" }}>
              {hasMultiple ? `Payment due (${index + 1} of ${groups.length})` : "Payment due"}
            </p>
            {hasMultiple && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  aria-label="Previous payment due"
                  disabled={index === 0}
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  className="w-6 h-6 flex items-center justify-center rounded-lg disabled:opacity-30 transition-opacity"
                  style={{ background: "rgba(146,100,10,0.12)", color: "#92640a" }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next payment due"
                  disabled={index === groups.length - 1}
                  onClick={() => setIndex((i) => Math.min(groups.length - 1, i + 1))}
                  className="w-6 h-6 flex items-center justify-center rounded-lg disabled:opacity-30 transition-opacity"
                  style={{ background: "rgba(146,100,10,0.12)", color: "#92640a" }}
                >
                  ›
                </button>
              </div>
            )}
          </div>
          <p
            className="text-xs mt-0.5 leading-relaxed"
            style={{ color: "rgba(0,38,105,0.55)" }}
          >
            {invited ? (
              <>
                You&apos;ve been invited
                {bookerName && (
                  <>
                    {" "}by <span className="capitalize font-medium">{bookerName}</span>
                  </>
                )}
                {" "}to play at {current.course_name} on{" "}
                {formatPendingDate(current.booking_date)} at{" "}
                {formatTeeTime(current.tee_time)}. Pay your share below — or
                {bookerName ? (
                  <>
                    {" "}have <span className="capitalize font-medium">{bookerName}</span> pay it
                  </>
                ) : (
                  " have the booker pay it"
                )}{" "}
                — to confirm your spot. This round is on hold until it&apos;s paid.
              </>
            ) : soleName ? (
              `Complete payment for ${soleName} round at ${current.course_name} on ${formatPendingDate(current.booking_date)} at ${formatTeeTime(current.tee_time)} before booking another.`
            ) : (
              `Complete the payments below for your ${current.course_name} round on ${formatPendingDate(current.booking_date)} at ${formatTeeTime(current.tee_time)} before booking another.`
            )}
          </p>

          {/* One row per player awaiting payment. When the querying member is
              the booker, this lists their own round first, then each additional
              player — with a "message" shortcut to nudge fellow members. An
              invited player only ever sees their own single row. */}
          <div className="mt-2 space-y-1.5">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <span
                  className="text-xs font-medium capitalize flex-1 min-w-0 truncate"
                  style={{ color: "var(--color-green-900)" }}
                >
                  {row.player_name}
                </span>
                {/* Message the player whose payment this is — never shown for
                    the member's own row, and only when they're a fellow member
                    (non-member guests have no account to message). Kept to the
                    left of the Pay CTA so the Pay button stays the rightmost
                    element on every row and lines up across rows. */}
                {row.target_member_id && (
                  <button
                    type="button"
                    aria-label={`Message ${row.player_name}`}
                    disabled={messagingId === row.target_member_id}
                    onClick={() => messageMember(row.target_member_id as string)}
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg disabled:opacity-50 transition-opacity"
                    style={{ background: "rgba(0,38,105,0.06)", color: "rgba(0,38,105,0.55)" }}
                  >
                    <MessageCircle className="w-3.5 h-3.5" strokeWidth={2} />
                  </button>
                )}
                {row.payment_url ? (
                  <a
                    href={row.payment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={refreshing}
                    onClick={(e) => {
                      if (refreshing) e.preventDefault();
                    }}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0 ${
                      refreshing ? "opacity-50 pointer-events-none" : ""
                    }`}
                    style={{ background: "var(--color-gold)", color: "var(--color-green-900)" }}
                  >
                    Pay →
                  </a>
                ) : (
                  <span
                    className="text-xs flex-shrink-0"
                    style={{ color: "rgba(0,38,105,0.4)" }}
                  >
                    Payment link unavailable
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* When the booker is paying on behalf of additional players, the
              external GHL payment form defaults to the payer's email. Paying
              for someone else under your own email records a second payment
              against you rather than the intended player — flag it so the
              booker enters that player's email instead. Only relevant to the
              booker (never an invited player) and only when there's at least
              one other player to pay for. */}
          {!invited && current.others.length > 0 && (
            <p
              className="text-xs mt-2 pt-2 leading-relaxed flex items-start gap-1.5"
              style={{
                color: "#92640a",
                borderTop: "1px solid rgba(146,100,10,0.15)",
              }}
            >
              <span className="leading-none mt-0.5">⚠️</span>
              <span>
                Paying for another player? Enter{" "}
                <span className="font-semibold">their</span> email in the
                payment form — not your own — so you&apos;re not charged twice
                for the same round.
              </span>
            </p>
          )}

          {messageError && (
            <p className="text-xs mt-1" style={{ color: "#b91c1c" }}>
              {messageError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Confirmation screen ------------------------------------

type PlayersForm = { players: AdditionalPlayer[] };

const inputBase =
  "w-full px-3 py-2 text-sm rounded-xl border bg-white outline-none transition-colors focus:border-green-700";
const inputStyle = {
  borderColor: "rgba(0,38,105,0.12)",
  color: "var(--color-green-900)",
};

function ConfirmScreen({
  slot,
  date,
  timezone,
  error,
  submitting,
  onSubmit,
  onBack,
  inviteMemberId,
  bookerEmail,
  eventName,
}: {
  slot: GHLBookingSlot;
  date: string;
  timezone: string;
  error: string;
  submitting: boolean;
  onSubmit: (additionalPlayers: AdditionalPlayer[]) => void;
  onBack: () => void;
  inviteMemberId?: string | null;
  bookerEmail: string;
  eventName?: string | null;
}) {
  const maxAdditional = Math.max(0, (slot.spotsOpen ?? 1) - 1);
  const [collapsed, setCollapsed] = useState<boolean[]>([]);
  const [playerSelections, setPlayerSelections] = useState<
    Array<MemberWithProfile | null>
  >([]);
  // Per-row entry mode. Member is the default; non-member captures a guest's
  // name/phone/email and flags the booking for admin review.
  const [playerKinds, setPlayerKinds] = useState<PlayerKind[]>([]);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  // Member ids flagged as having a payment due on an existing booking. The FIFO
  // rule bars a booker from adding such a member to a group round, so a flagged
  // selection blocks submit until they're removed. Checked on selection via
  // /api/bookings/check-guests; POST /api/bookings/create is the real gate.
  const [pendingGuestIds, setPendingGuestIds] = useState<Set<string>>(
    () => new Set(),
  );
  const inviteApplied = useRef(false);

  useEffect(() => {
    fetch("/api/members?exclude_self=true")
      .then((r) => r.json())
      .then((d) => setMembers(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const {
    control,
    handleSubmit,
    setValue,
    register,
    watch,
    clearErrors,
    formState: { errors },
  } = useForm<PlayersForm>({
    defaultValues: { players: [] },
    mode: "onChange",
  });

  const watchedPlayers = watch("players");

  // Shared RHF validators for non-member guest fields. Returning a string makes
  // react-hook-form surface it as the field error message.
  const normalisedBookerEmail = bookerEmail.trim().toLowerCase();

  function validateGuestEmail(value: string | undefined): true | string {
    if (!value || !validateEmail(value).valid)
      return "Enter a valid email address";
    if (
      normalisedBookerEmail &&
      value.trim().toLowerCase() === normalisedBookerEmail
    ) {
      return "That's your email — you're already on this tee time";
    }
    return true;
  }

  function validateGuestPhone(value: string | undefined): true | string {
    return isValidGuestPhone(value) ? true : "Enter a valid phone number";
  }

  const { fields, append, remove } = useFieldArray({
    control,
    name: "players",
  });

  // Auto-add invited member when coming from a profile page via ?invite=<id>
  useEffect(() => {
    if (inviteApplied.current || !inviteMemberId || members.length === 0)
      return;
    if (maxAdditional === 0) return;
    const member = members.find((m) => m.id === inviteMemberId);
    if (!member) return;
    inviteApplied.current = true;
    append({
      firstName: member.first_name,
      lastName: member.last_name,
      mobile: member.phone ?? "",
      email: member.email,
    });
    setCollapsed((prev) => [...prev, false]);
    setPlayerSelections((prev) => [...prev, member]);
    setPlayerKinds((prev) => [...prev, "member"]);
  }, [members, inviteMemberId, maxAdditional, append]);

  function addPlayer() {
    if (fields.length >= maxAdditional) return;
    append({ firstName: "", lastName: "", mobile: "", email: "" });
    setCollapsed((prev) => [...prev, false]);
    setPlayerSelections((prev) => [...prev, null]);
    setPlayerKinds((prev) => [...prev, "member"]);
  }

  function removePlayer(i: number) {
    remove(i);
    setCollapsed((prev) => prev.filter((_, idx) => idx !== i));
    setPlayerSelections((prev) => prev.filter((_, idx) => idx !== i));
    setPlayerKinds((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Switch a row between member-search and non-member entry, clearing any
  // captured values so the two modes never bleed into each other.
  function setPlayerKind(i: number, kind: PlayerKind) {
    setPlayerKinds((prev) => prev.map((k, idx) => (idx === i ? kind : k)));
    setPlayerSelections((prev) => prev.map((s, idx) => (idx === i ? null : s)));
    setCollapsed((prev) => prev.map((c, idx) => (idx === i ? false : c)));
    setValue(`players.${i}.firstName`, "", { shouldValidate: false });
    setValue(`players.${i}.lastName`, "", { shouldValidate: false });
    setValue(`players.${i}.email`, "", { shouldValidate: false });
    setValue(`players.${i}.mobile`, "", { shouldValidate: false });
    clearErrors([
      `players.${i}.firstName`,
      `players.${i}.lastName`,
      `players.${i}.email`,
      `players.${i}.mobile`,
    ]);
  }

  // A row is valid when a member is selected, or — for non-members — a valid
  // email and phone have been entered (names are optional).
  function rowValid(i: number): boolean {
    if (playerKinds[i] === "non_member") {
      const p = watchedPlayers?.[i];
      return (
        validateGuestEmail(p?.email) === true &&
        validateGuestPhone(p?.mobile) === true
      );
    }
    const selection = playerSelections[i];
    // A selected member with a payment due can't be booked — block submit until
    // they're removed (mirrors the server-side FIFO gate).
    return !!selection && !pendingGuestIds.has(selection.id);
  }

  const allRowsValid = fields.every((_, i) => rowValid(i));

  function toggleCollapsed(i: number) {
    if (!playerSelections[i]) return;
    setCollapsed((prev) => prev.map((c, idx) => (idx === i ? !c : c)));
  }

  function selectMember(i: number, member: MemberWithProfile) {
    setValue(`players.${i}.firstName`, member.first_name, {
      shouldValidate: true,
    });
    setValue(`players.${i}.lastName`, member.last_name, {
      shouldValidate: true,
    });
    setValue(`players.${i}.email`, member.email, { shouldValidate: true });
    setValue(`players.${i}.mobile`, member.phone ?? "", {
      shouldValidate: true,
    });
    setPlayerSelections((prev) =>
      prev.map((s, idx) => (idx === i ? member : s)),
    );
    // Flag the member if they owe payment on an existing booking — the FIFO gate
    // rejects the whole group server-side, so surface it the moment they're
    // picked rather than at submit.
    fetch(`/api/bookings/check-guests?ids=${encodeURIComponent(member.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (
          d &&
          Array.isArray(d.blockedMemberIds) &&
          d.blockedMemberIds.includes(member.id)
        ) {
          setPendingGuestIds((prev) => new Set(prev).add(member.id));
        }
      })
      .catch(() => {});
  }

  function clearMemberSelection(i: number) {
    setPlayerSelections((prev) => prev.map((s, idx) => (idx === i ? null : s)));
    setValue(`players.${i}.firstName`, "", { shouldValidate: false });
    setValue(`players.${i}.lastName`, "", { shouldValidate: false });
    setValue(`players.${i}.email`, "", { shouldValidate: false });
    setValue(`players.${i}.mobile`, "", { shouldValidate: false });
    setCollapsed((prev) => prev.map((c, idx) => (idx === i ? false : c)));
  }

  function playerLabel(i: number): string {
    const selection = playerSelections[i];
    if (selection)
      return `${selection.first_name} ${selection.last_name}`.trim();
    if (playerKinds[i] === "non_member") {
      const p = watchedPlayers?.[i];
      const name = `${p?.firstName ?? ""} ${p?.lastName ?? ""}`.trim();
      return name || `Guest ${i + 2}`;
    }
    return `Player ${i + 2}`;
  }

  // Ids already chosen (to exclude from autocomplete)
  const selectedMemberIds = playerSelections.flatMap((s) => (s ? [s.id] : []));

  return (
    <div>
      <div className="top-bar flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm"
          style={{ color: "rgba(255,255,255,0.75)" }}
        >
          ← Back
        </button>
        <h1 className="text-sm font-medium" style={{ color: "white" }}>
          Confirm Booking
        </h1>
        <div className="w-12" />
      </div>

      <form
        onSubmit={handleSubmit((data) =>
          onSubmit(
            data.players.map((p, i) => ({
              ...p,
              memberId: playerSelections[i]?.id,
              isNonMember: playerKinds[i] === "non_member",
            })),
          ),
        )}
        noValidate
      >
        <div className="px-5 md:px-8 py-6 space-y-5 md:max-w-2xl md:mx-auto">
          {/* Booking hero */}
          <div className="card p-5">
            <p
              className="text-xs uppercase tracking-widest mb-3"
              style={{ color: "rgba(0,38,105,0.35)", letterSpacing: "0.12em" }}
            >
              {eventName ?? "Park Hyatt Aviara"}
            </p>
            <p
              className="font-sans font-black"
              style={{
                fontSize: "2.25rem",
                color: "var(--color-green-900)",
                lineHeight: 1,
              }}
            >
              {formatSlotTime(slot.startTime)}
            </p>
            <p
              className="text-sm mt-1.5"
              style={{ color: "rgba(0,38,105,0.6)" }}
            >
              {format(new Date(date + "T12:00:00"), "EEEE, MMMM d, yyyy")}
            </p>
            <div
              className="flex items-center gap-3 mt-3 pt-3 border-t"
              style={{ borderColor: "rgba(0,38,105,0.07)" }}
            >
              <span
                className="text-xs"
                style={{ color: "rgba(0,38,105,0.38)" }}
              >
                {timezone.replace(/_/g, " ")}
              </span>
              <span style={{ color: "rgba(0,38,105,0.18)" }}>·</span>
              <span
                className="text-xs"
                style={{ color: "rgba(0,38,105,0.38)" }}
              >
                ${BOOKING_PRICE_USD} per player
              </span>
            </div>
          </div>

          {/* Players */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="section-label">Players</p>
              <span
                className="text-xs"
                style={{ color: "rgba(0,38,105,0.35)" }}
              >
                {1 + fields.length} / {1 + maxAdditional} spots
              </span>
            </div>

            {/* Booking member (you) */}
            <div className="card px-4 py-3 mb-2 flex items-center gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{
                  background: "rgba(133,187,101,0.15)",
                  color: "var(--color-green-700)",
                }}
              >
                1
              </div>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--color-green-900)" }}
              >
                You
              </p>
              <span
                className="ml-auto text-xs"
                style={{ color: "rgba(0,38,105,0.35)" }}
              >
                Primary
              </span>
            </div>

            {/* Additional players */}
            {fields.map((field, i) => {
              const isCollapsed = collapsed[i] ?? false;
              const selection = playerSelections[i] ?? null;
              const kind = playerKinds[i] ?? "member";
              const canCollapse = !!selection;
              const rowErrors = errors.players?.[i];
              const isPendingBlocked = selection
                ? pendingGuestIds.has(selection.id)
                : false;

              return (
                <div
                  key={field.id}
                  className="card mb-2"
                  style={
                    isPendingBlocked
                      ? {
                          borderColor: "rgba(220,38,38,0.4)",
                          background: "rgba(239,68,68,0.03)",
                        }
                      : undefined
                  }
                >
                  {/* Header row */}
                  <div className="flex items-center gap-2 px-4 py-3">
                    <button
                      type="button"
                      className={cn(
                        "flex-1 flex items-center gap-2 text-left min-w-0",
                        !canCollapse && "cursor-default",
                      )}
                      onClick={() => canCollapse && toggleCollapsed(i)}
                    >
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{
                          background: "rgba(0,38,105,0.06)",
                          color: "var(--color-green-900)",
                        }}
                      >
                        {i + 2}
                      </div>
                      <span
                        className="text-sm font-medium flex-1 truncate capitalize"
                        style={{ color: "var(--color-green-900)" }}
                      >
                        {playerLabel(i)}
                      </span>
                      {isPendingBlocked && (
                        <span
                          className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            color: "#dc2626",
                            background: "rgba(220,38,38,0.1)",
                          }}
                        >
                          Payment due
                        </span>
                      )}
                      {isCollapsed && selection && !isPendingBlocked && (
                        <svg
                          className="w-4 h-4 flex-shrink-0"
                          viewBox="0 0 16 16"
                          fill="none"
                          style={{ color: "var(--color-green-700)" }}
                        >
                          <path
                            d="M2.5 8.5l3.5 3.5 7.5-8"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                      {canCollapse && (
                        <svg
                          className={cn(
                            "w-4 h-4 flex-shrink-0 transition-transform duration-200",
                            isCollapsed ? "" : "rotate-180",
                          )}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          style={{ color: "rgba(0,38,105,0.35)" }}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                          />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removePlayer(i)}
                      className="text-xs px-2 py-1 rounded-lg transition-colors flex-shrink-0"
                      style={{
                        color: "rgba(220,38,38,0.65)",
                        background: "rgba(220,38,38,0.06)",
                      }}
                    >
                      Remove
                    </button>
                  </div>

                  {/* Collapsible body */}
                  {!isCollapsed && (
                    <div
                      className="px-4 pb-4 space-y-3 border-t"
                      style={{ borderColor: "rgba(0,38,105,0.07)" }}
                    >
                      {selection ? (
                        // Member selected
                        <>
                        <div className="pt-3 flex items-center gap-3">
                          {selection.profile?.avatar_url ? (
                            <Image
                              src={selection.profile.avatar_url}
                              alt=""
                              width={32}
                              height={32}
                              className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <div
                              className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                              style={{
                                background: "rgba(133,187,101,0.15)",
                                color: "var(--color-green-700)",
                              }}
                            >
                              <span className="uppercase">
                                {selection.first_name[0]}
                                {selection.last_name[0]}
                              </span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p
                              className="text-sm font-medium capitalize"
                              style={{ color: "var(--color-green-900)" }}
                            >
                              {selection.first_name} {selection.last_name}
                            </p>
                            <p
                              className="text-xs truncate"
                              style={{ color: "rgba(0,38,105,0.45)" }}
                            >
                              {selection.email}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => clearMemberSelection(i)}
                            className="text-xs px-2 py-1 rounded-lg flex-shrink-0"
                            style={{
                              color: "rgba(0,38,105,0.45)",
                              background: "rgba(0,38,105,0.05)",
                            }}
                          >
                            Change
                          </button>
                        </div>
                        {isPendingBlocked && (
                          <p className="text-xs text-red-600 leading-snug">
                            {selection.first_name} has a payment due on an
                            existing booking and can&apos;t be added until
                            it&apos;s paid. Please remove them to continue.
                          </p>
                        )}
                        </>
                      ) : (
                        <div className="pt-3 space-y-3">
                          {/* Member / Non-member segmented toggle */}
                          <div
                            className="flex gap-1 p-1 rounded-xl"
                            style={{ background: "rgba(0,38,105,0.05)" }}
                          >
                            {(
                              [
                                ["member", "Member"],
                                ["non_member", "Non-member"],
                              ] as [PlayerKind, string][]
                            ).map(([k, label]) => {
                              const active = kind === k;
                              return (
                                <button
                                  key={k}
                                  type="button"
                                  onClick={() => {
                                    if (kind !== k) setPlayerKind(i, k);
                                  }}
                                  className="flex-1 py-2 text-xs font-semibold rounded-lg transition-all"
                                  style={
                                    active
                                      ? {
                                          background: "white",
                                          color: "var(--color-green-900)",
                                          boxShadow:
                                            "0 1px 3px rgba(0,38,105,0.12)",
                                        }
                                      : { color: "rgba(0,38,105,0.5)" }
                                  }
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>

                          {kind === "member" ? (
                            <MemberAutocomplete
                              members={members}
                              excludeIds={selectedMemberIds}
                              onSelect={(m) => selectMember(i, m)}
                            />
                          ) : (
                            <>
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  {...register(`players.${i}.firstName`, {
                                    maxLength: {
                                      value: 100,
                                      message: "Max 100 characters",
                                    },
                                  })}
                                  placeholder="First name (optional)"
                                  autoComplete="off"
                                  className={inputBase}
                                  style={inputStyle}
                                />
                                <input
                                  {...register(`players.${i}.lastName`, {
                                    maxLength: {
                                      value: 100,
                                      message: "Max 100 characters",
                                    },
                                  })}
                                  placeholder="Last name (optional)"
                                  autoComplete="off"
                                  className={inputBase}
                                  style={inputStyle}
                                />
                              </div>
                              <div>
                                <input
                                  {...register(`players.${i}.mobile`, {
                                    validate: (v) =>
                                      playerKinds[i] !== "non_member" ||
                                      validateGuestPhone(v),
                                  })}
                                  type="tel"
                                  inputMode="tel"
                                  placeholder="Phone number (required)"
                                  autoComplete="off"
                                  className={inputBase}
                                  style={
                                    rowErrors?.mobile
                                      ? {
                                          ...inputStyle,
                                          borderColor: "#dc2626",
                                        }
                                      : inputStyle
                                  }
                                />
                                {rowErrors?.mobile && (
                                  <p className="text-xs mt-1 text-red-600">
                                    {rowErrors.mobile.message}
                                  </p>
                                )}
                              </div>
                              <div>
                                <input
                                  {...register(`players.${i}.email`, {
                                    validate: (v) =>
                                      playerKinds[i] !== "non_member" ||
                                      validateGuestEmail(v),
                                  })}
                                  type="email"
                                  inputMode="email"
                                  placeholder="Email (required)"
                                  autoComplete="off"
                                  className={inputBase}
                                  style={
                                    rowErrors?.email
                                      ? {
                                          ...inputStyle,
                                          borderColor: "#dc2626",
                                        }
                                      : inputStyle
                                  }
                                />
                                {rowErrors?.email && (
                                  <p className="text-xs mt-1 text-red-600">
                                    {rowErrors.email.message}
                                  </p>
                                )}
                              </div>
                              {(rowErrors?.firstName ||
                                rowErrors?.lastName) && (
                                <p className="text-xs text-red-600">
                                  {
                                    (rowErrors.firstName || rowErrors.lastName)
                                      ?.message
                                  }
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {fields.length < maxAdditional && (
              <button
                type="button"
                onClick={addPlayer}
                className="w-full py-3 rounded-2xl border-2 border-dashed text-sm font-medium transition-colors mt-1"
                style={{
                  borderColor: "rgba(0,38,105,0.12)",
                  color: "rgba(0,38,105,0.4)",
                }}
              >
                + Add another player
              </button>
            )}

            {maxAdditional === 0 && (
              <p
                className="text-xs text-center mt-1"
                style={{ color: "rgba(0,38,105,0.35)" }}
              >
                This slot has only 1 spot remaining.
              </p>
            )}
          </div>

          {/* What happens next */}
          <div className="px-1 space-y-2.5">
            <p className="section-label">What happens next</p>
            {[
              "Availability verified with the course",
              "Payment link sent to your email",
              "Payment confirms your booking",
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <span
                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{
                    background: "rgba(133,187,101,0.12)",
                    color: "var(--color-green-700)",
                  }}
                >
                  {i + 1}
                </span>
                <span
                  className="text-sm"
                  style={{ color: "rgba(0,38,105,0.5)" }}
                >
                  {s}
                </span>
              </div>
            ))}
          </div>

          {error && (
            <div
              className="rounded-2xl border px-5 py-4"
              style={{
                background: "rgba(239,68,68,0.05)",
                borderColor: "rgba(239,68,68,0.15)",
              }}
            >
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !allRowsValid}
            className="btn btn-gold btn-full disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Spinner className="w-4 h-4 text-green-900" /> Submitting…
              </>
            ) : (
              `Submit booking request${fields.length > 0 ? ` · ${1 + fields.length} players` : ""}`
            )}
          </button>

          <p
            className="text-xs text-center"
            style={{ color: "rgba(0,38,105,0.28)" }}
          >
            No payment charged now.
          </p>
        </div>
      </form>
    </div>
  );
}

// ---- Member autocomplete ------------------------------------

function MemberAutocomplete({
  members,
  excludeIds,
  onSelect,
}: {
  members: MemberWithProfile[];
  excludeIds: string[];
  onSelect: (m: MemberWithProfile) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{
    left: number;
    width: number;
    placeAbove: boolean;
    // Exactly one of top/bottom is set, depending on placement.
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const VISIBLE_ROWS = 4;
  const ROW_HEIGHT = 52; // px — matches py-2.5 + content height

  function measureInput() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const desired = VISIBLE_ROWS * ROW_HEIGHT;
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    // Flip the list above the input when there isn't room below (e.g. the input
    // sits low inside a bottom sheet) and there's more room above. Anchoring by
    // `bottom` then grows the list upward from just above the input.
    const placeAbove = spaceBelow < desired && spaceAbove > spaceBelow;
    const avail = (placeAbove ? spaceAbove : spaceBelow) - 8;
    setDropdownRect({
      left: r.left,
      width: r.width,
      placeAbove,
      top: placeAbove ? undefined : r.bottom + 4,
      bottom: placeAbove ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.max(0, Math.min(desired, avail)),
    });
  }

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      const target = e.target as Node;
      // The results list is portaled to <body>, so it's outside wrapperRef in
      // the DOM — exempt it explicitly, or clicking a result would be treated
      // as an outside click and close the list before the selection registers.
      if (dropdownRef.current?.contains(target)) return;
      if (wrapperRef.current && !wrapperRef.current.contains(target))
        setOpen(false);
    }
    function handleScroll(e: Event) {
      // Allow scrolling inside the dropdown itself
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, []);

  const filtered =
    query.trim().length >= 1
      ? members
          .filter((m) => {
            if (excludeIds.includes(m.id)) return false;
            const q = query.toLowerCase();
            return (
              `${m.first_name} ${m.last_name}`.toLowerCase().includes(q) ||
              m.email.toLowerCase().includes(q)
            );
          })
          .slice(0, 20)
      : [];

  return (
    <div ref={wrapperRef}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        autoComplete="off"
        placeholder="Search members…"
        className={inputBase}
        style={inputStyle}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          measureInput();
        }}
        onFocus={() => {
          setOpen(true);
          measureInput();
        }}
      />
      {open &&
        filtered.length > 0 &&
        dropdownRect &&
        typeof document !== "undefined" &&
        createPortal(
        <div
          ref={dropdownRef}
          className="bg-white rounded-xl border shadow-lg"
          style={{
            position: "fixed",
            ...(dropdownRect.placeAbove
              ? { bottom: dropdownRect.bottom }
              : { top: dropdownRect.top }),
            left: dropdownRect.left,
            width: dropdownRect.width,
            zIndex: 9999,
            borderColor: "rgba(0,38,105,0.12)",
            maxHeight: dropdownRect.maxHeight,
            overflowY: "auto",
          }}
        >
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(m);
                setQuery("");
                setOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-green-50"
            >
              {m.profile?.avatar_url ? (
                <Image
                  src={m.profile.avatar_url}
                  alt=""
                  width={28}
                  height={28}
                  className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold uppercase"
                  style={{
                    background: "rgba(133,187,101,0.15)",
                    color: "var(--color-green-700)",
                  }}
                >
                  {m.first_name[0]}
                  {m.last_name[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium truncate capitalize"
                  style={{ color: "var(--color-green-900)" }}
                >
                  {m.first_name} {m.last_name}
                </p>
                <p
                  className="text-xs truncate"
                  style={{ color: "rgba(0,38,105,0.45)" }}
                >
                  {m.email}
                </p>
              </div>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---- Success screen -----------------------------------------

// The post-golf group dinner is an Aviara-only offering, so the RSVP prompt is
// shown only when the booking is for the Aviara course/event.
const isAviaraEvent = (name?: string | null) => !!name && /aviara/i.test(name);

function SuccessScreen({
  booking,
  onDone,
  onUpdateBooking,
}: {
  booking: {
    date: string;
    time: string;
    players: number;
    pendingNonMembers: number;
    bookingId: string | null;
    eventName: string;
  };
  onDone: () => void;
  onUpdateBooking: (bookingId: string, updates: Partial<Booking>) => void;
}) {
  const [dinnerRsvp, setDinnerRsvp] = useState<"yes" | "no" | "maybe" | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const showDinner = !!booking.bookingId && isAviaraEvent(booking.eventName);

  async function handleDone() {
    if (booking.bookingId && dinnerRsvp) {
      setSubmitting(true);
      const res = await fetch(
        `/api/bookings/${booking.bookingId}/dinner-rsvp`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rsvp: dinnerRsvp }),
        },
      );
      if (res.ok)
        onUpdateBooking(booking.bookingId, { dinner_rsvp: dinnerRsvp });
      setSubmitting(false);
    }
    onDone();
  }

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-8 text-center"
      style={{ background: "var(--color-cream)" }}
    >
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6"
        style={{
          background: "rgba(133,187,101,0.12)",
          border: "1px solid rgba(133,187,101,0.2)",
        }}
      >
        ⛳
      </div>
      <h1
        className="font-sans font-black mb-2"
        style={{ fontSize: "2rem", color: "var(--color-green-900)" }}
      >
        Request submitted!
      </h1>
      <p className="text-sm mb-1" style={{ color: "rgba(0,38,105,0.5)" }}>
        {booking.date} at {booking.time}
      </p>
      <p className="text-sm mb-1" style={{ color: "rgba(0,38,105,0.5)" }}>
        {booking.eventName}
      </p>
      {booking.players > 1 && (
        <p className="text-sm mb-8" style={{ color: "rgba(0,38,105,0.45)" }}>
          {booking.players} players
        </p>
      )}
      {booking.players <= 1 && <div className="mb-8" />}
      <div className="card p-5 w-full max-w-sm mb-4 text-left space-y-2">
        <p
          className="text-xs uppercase tracking-widest mb-3"
          style={{ color: "rgba(0,38,105,0.35)", letterSpacing: "0.14em" }}
        >
          What&apos;s next
        </p>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "rgba(0,38,105,0.6)" }}
        >
          We&apos;ll verify availability with the course and send a payment link
          to your email.
        </p>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "rgba(0,38,105,0.6)" }}
        >
          Your booking is confirmed once payment is complete.
        </p>
        {booking.pendingNonMembers > 0 && (
          <p
            className="text-sm leading-relaxed pt-2 mt-2 border-t"
            style={{
              color: "rgba(0,38,105,0.6)",
              borderColor: "rgba(0,38,105,0.08)",
            }}
          >
            {booking.pendingNonMembers} non-member guest
            {booking.pendingNonMembers !== 1 ? "s" : ""} need
            {booking.pendingNonMembers !== 1 ? "" : "s"} admin approval.
            We&apos;ll let you know once they&apos;re confirmed.
          </p>
        )}
      </div>
      {showDinner && (
        <div className="card p-5 w-full max-w-sm mb-8 text-left">
          <p
            className="text-xs uppercase tracking-widest mb-3"
            style={{ color: "rgba(0,38,105,0.35)", letterSpacing: "0.14em" }}
          >
            Staying for dinner?
          </p>
          <p className="text-sm mb-4" style={{ color: "rgba(0,38,105,0.6)" }}>
            Should we reserve a seat for you at group table for post-golf
            drinks/dinner?
          </p>
          <DinnerRsvp
            bookingId={booking.bookingId!}
            current={dinnerRsvp}
            layout="horizontal"
            autoSave={false}
            onSaved={setDinnerRsvp}
          />
        </div>
      )}
      {!showDinner && <div className="mb-8" />}
      <button
        onClick={handleDone}
        disabled={(showDinner && dinnerRsvp === null) || submitting}
        className="btn btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? "Saving…" : "Back to booking"}
      </button>
      {showDinner && dinnerRsvp === null && (
        <p className="text-xs mt-3" style={{ color: "rgba(0,38,105,0.4)" }}>
          Please let us know about dinner first.
        </p>
      )}
    </div>
  );
}

// ---- My bookings tab ----------------------------------------

const STATUS_LABELS: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  awaiting_approval: {
    label: "Awaiting admin approval",
    color: "#92640a",
    bg: "rgba(234,179,8,0.08)",
  },
  tentative: {
    label: "Pending",
    color: "#92640a",
    bg: "rgba(234,179,8,0.08)",
  },
  availability_confirmed: {
    label: "Payment due",
    color: "#166534",
    bg: "rgba(34,197,94,0.08)",
  },
  payment_confirmed: {
    label: "Payment confirmed",
    color: "#166534",
    bg: "rgba(34,197,94,0.08)",
  },
  confirmed: {
    label: "Confirmed",
    color: "#166534",
    bg: "rgba(34,197,94,0.08)",
  },
  pending: { label: "Pending", color: "#92640a", bg: "rgba(234,179,8,0.08)" },
  cancelled: {
    label: "Cancelled",
    color: "#6b7280",
    bg: "rgba(107,114,128,0.08)",
  },
};

function BookingStatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? {
    label: status,
    color: "#6b7280",
    bg: "rgba(107,114,128,0.08)",
  };
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
}

function getPolicyTier(bookingDateTime: string) {
  const hours = differenceInHours(new Date(bookingDateTime), new Date());
  if (hours >= 72) return POLICY_TIERS[0];
  if (hours >= 48) return POLICY_TIERS[1];
  return POLICY_TIERS[2];
}

function CancelModal({
  open,
  bookingDateTime,
  title,
  ghlBookingId,
  onDismiss,
}: {
  open: boolean;
  bookingDateTime: string;
  title: string;
  ghlBookingId: string | null;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const ids: number[] = [];
      ids[0] = requestAnimationFrame(() => {
        ids[1] = requestAnimationFrame(() => setVisible(true));
      });
      return () => ids.forEach((id) => cancelAnimationFrame(id));
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
  }, [open]);

  const activeTier = bookingDateTime ? getPolicyTier(bookingDateTime) : null;
  const cancelUrl = ghlBookingId
    ? `${GHL_CANCEL_BOOKING_URL}?event_id=${ghlBookingId}`
    : GHL_CANCEL_BOOKING_URL;

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Close"
        className={[
          "absolute inset-0 w-full h-full",
          visible ? "opacity-100" : "opacity-0",
        ].join(" ")}
        style={{
          background: "rgba(0,0,0,0.45)",
          transition: "opacity 200ms ease-out",
          willChange: "opacity",
        }}
        onClick={onDismiss}
      />
      <div
        className={[
          "relative bg-white rounded-t-3xl md:rounded-3xl px-5 pt-5 pb-8 space-y-4 w-full md:max-w-md",
          visible ? "translate-y-0" : "translate-y-full",
        ].join(" ")}
        style={{
          boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
          transition: visible
            ? "transform 340ms cubic-bezier(0.32,0.72,0,1)"
            : "transform 240ms cubic-bezier(0.4,0,1,1)",
          willChange: "transform",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p
            className="font-sans font-black text-lg"
            style={{ color: "var(--color-green-900)" }}
          >
            {title}
          </p>
          <button
            onClick={onDismiss}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{
              background: "rgba(0,38,105,0.06)",
              color: "rgba(0,38,105,0.5)",
            }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Cancellation policy */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(0,38,105,0.08)" }}
        >
          <div
            className="px-4 py-2.5"
            style={{ background: "rgba(0,38,105,0.03)" }}
          >
            <p
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: "rgba(0,38,105,0.4)" }}
            >
              Cancellation policy
            </p>
          </div>
          {POLICY_TIERS.map((tier) => {
            const isActive = activeTier === tier;
            return (
              <div
                key={tier.label}
                className="flex items-start gap-3 px-4 py-3"
                style={{
                  background: isActive ? tier.bg : "white",
                  borderTop: "1px solid rgba(0,38,105,0.06)",
                }}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                  style={{
                    background: isActive ? tier.color : "rgba(0,38,105,0.15)",
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-xs font-semibold"
                    style={{
                      color: isActive ? tier.color : "rgba(0,38,105,0.45)",
                    }}
                  >
                    {tier.label}
                  </p>
                  <p
                    className="text-xs mt-0.5"
                    style={{
                      color: isActive ? tier.color : "rgba(0,38,105,0.35)",
                    }}
                  >
                    {tier.desc}
                  </p>
                </div>
                {isActive && (
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: tier.bg, color: tier.color }}
                  >
                    {tier.credit}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <button
          onClick={() => {
            window.open(cancelUrl, "_blank", "noopener,noreferrer");
            onDismiss();
          }}
          className="w-full py-3.5 rounded-2xl text-sm font-semibold text-center"
          style={{ background: "rgba(220,38,38,0.9)", color: "white" }}
        >
          Continue to cancellation form
        </button>
      </div>
    </div>
  );
}

// ---- Edit guest modal ---------------------------------------
// Lets the booker fix a non-member guest's contact details while that
// guest's booking row is still awaiting admin approval — e.g. when an
// admin leaves a note asking for a corrected email or phone number.

interface EditGuestTarget {
  bookingId: string;
  player: AdditionalPlayer;
}

function EditGuestModal({
  target,
  onDismiss,
  onSaved,
}: {
  target: EditGuestTarget | null;
  onDismiss: () => void;
  onSaved: (
    bookingId: string,
    guestName: string,
    player: AdditionalPlayer,
  ) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const open = !!target;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setFirstName(target?.player.firstName ?? "");
      setLastName(target?.player.lastName ?? "");
      setEmail(target?.player.email ?? "");
      setMobile(target?.player.mobile ?? "");
      setError("");
      const ids: number[] = [];
      ids[0] = requestAnimationFrame(() => {
        ids[1] = requestAnimationFrame(() => setVisible(true));
      });
      return () => ids.forEach((id) => cancelAnimationFrame(id));
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.bookingId]);

  if (!mounted) return null;

  const inputCls =
    "w-full px-3 py-2 text-sm rounded-xl border bg-white outline-none transition-colors focus:border-green-700";
  const inputStyle = {
    borderColor: "rgba(0,38,105,0.12)",
    color: "var(--color-green-900)",
  };

  async function handleSave() {
    if (!target) return;
    if (!validateEmail(email).valid) {
      setError("Enter a valid email address");
      return;
    }
    if (!isValidGuestPhone(mobile)) {
      setError("Enter a valid phone number");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/bookings/${target.bookingId}/guest`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, mobile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save changes. Please try again.");
        return;
      }
      onSaved(target.bookingId, data.guest_name, data.additional_players[0]);
      onDismiss();
    } catch {
      setError("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Close"
        className={[
          "absolute inset-0 w-full h-full",
          visible ? "opacity-100" : "opacity-0",
        ].join(" ")}
        style={{
          background: "rgba(0,0,0,0.45)",
          transition: "opacity 200ms ease-out",
          willChange: "opacity",
        }}
        onClick={onDismiss}
      />
      <div
        className={[
          "relative bg-white rounded-t-3xl md:rounded-3xl px-5 pt-5 pb-8 space-y-4 w-full md:max-w-md",
          visible ? "translate-y-0" : "translate-y-full",
        ].join(" ")}
        style={{
          boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
          transition: visible
            ? "transform 340ms cubic-bezier(0.32,0.72,0,1)"
            : "transform 240ms cubic-bezier(0.4,0,1,1)",
          willChange: "transform",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p
            className="font-sans font-black text-lg"
            style={{ color: "var(--color-green-900)" }}
          >
            Edit guest details
          </p>
          <button
            onClick={onDismiss}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{
              background: "rgba(0,38,105,0.06)",
              color: "rgba(0,38,105,0.5)",
            }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <p className="text-xs" style={{ color: "rgba(0,38,105,0.45)" }}>
          Still awaiting admin approval — you can fix their details until then.
        </p>

        {/* Form */}
        <div className="grid grid-cols-2 gap-2.5">
          <input
            className={inputCls}
            style={inputStyle}
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <input
            className={inputCls}
            style={inputStyle}
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <input
          type="email"
          className={inputCls}
          style={inputStyle}
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="tel"
          className={inputCls}
          style={inputStyle}
          placeholder="Phone number"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
        />

        {error && (
          <p className="text-xs" style={{ color: "rgba(220,38,38,0.85)" }}>
            {error}
          </p>
        )}

        {/* CTA */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3.5 rounded-2xl text-sm font-semibold text-center disabled:opacity-60"
          style={{ background: "var(--color-green-900)", color: "white" }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// ---- Dinner RSVP widget ------------------------------------

function DinnerRsvp({
  bookingId,
  current,
  onSaved,
  layout = "compact",
  autoSave = true,
}: {
  bookingId: string;
  current: "yes" | "no" | "maybe" | null;
  onSaved: (rsvp: "yes" | "no" | "maybe") => void;
  layout?: "compact" | "horizontal";
  autoSave?: boolean;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  async function pick(rsvp: "yes" | "no" | "maybe") {
    if (saving) return;
    if (!autoSave) {
      onSaved(rsvp);
      return;
    }
    setSaving(rsvp);
    const res = await fetch(`/api/bookings/${bookingId}/dinner-rsvp`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rsvp }),
    });
    if (res.ok) onSaved(rsvp);
    setSaving(null);
  }

  const opts = [
    { value: "yes" as const, label: "Yes" },
    { value: "no" as const, label: "No" },
    { value: "maybe" as const, label: "Maybe" },
  ];

  if (layout === "horizontal") {
    return (
      <div className="flex gap-2">
        {opts.map(({ value, label }) => {
          const active = current === value;
          return (
            <button
              key={value}
              onClick={() => pick(value)}
              disabled={!!saving}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
              style={
                active
                  ? {
                      background: "var(--color-green-900)",
                      color: "var(--color-gold)",
                    }
                  : {
                      background: "rgba(0,38,105,0.06)",
                      color: "rgba(0,38,105,0.5)",
                    }
              }
            >
              {saving === value ? "…" : label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 flex-shrink-0">
      <p
        className="text-[10px] font-medium"
        style={{ color: "rgba(0,38,105,0.38)" }}
      >
        Dinner?
      </p>
      <div className="flex gap-1">
        {opts.map(({ value, label }) => {
          const active = current === value;
          return (
            <button
              key={value}
              onClick={() => pick(value)}
              disabled={!!saving}
              className="h-7 px-2.5 rounded-full text-[11px] font-semibold transition-all disabled:opacity-50"
              style={
                active
                  ? {
                      background: "var(--color-green-900)",
                      color: "var(--color-gold)",
                    }
                  : {
                      background: "rgba(0,38,105,0.06)",
                      color: "rgba(0,38,105,0.45)",
                    }
              }
            >
              {saving === value ? "…" : label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type BookingGroup = {
  primary: Booking;
  players: Booking[];
};

// Grouped by (booker + tee time + created_at) rather than just date/time —
// two separate booking groups can land on the same tee time by coincidence
// and must not be merged into one card. Rows inserted together (one
// transaction) share the exact same created_at, since Postgres evaluates
// now() once per statement. Status is intentionally excluded from the key:
// one player cancelling their own spot must stay nested in the same group
// (as a cancelled row inside allRows), not fork into its own fabricated
// single-row "booking" — which section a group displays under is decided
// later, from the primary/booker row's status alone.
function groupBookings(bookings: Booking[]): BookingGroup[] {
  const bySlot = new Map<string, Booking[]>();
  for (const b of bookings) {
    const key = `${b.member_id}_${b.created_at}_${b.booking_date}_${b.tee_time}`;
    const slot = bySlot.get(key) ?? [];
    slot.push(b);
    bySlot.set(key, slot);
  }
  const groups: BookingGroup[] = [];
  for (const slot of bySlot.values()) {
    const primary =
      slot.find((b) => b.guest_name === null && !b.player_member_id) ?? slot[0];
    if (!primary) continue;
    groups.push({ primary, players: slot.filter((b) => b.id !== primary.id) });
  }
  return groups;
}

interface CancelTarget {
  bookingDateTime: string;
  title: string;
  ghlBookingId: string | null;
}

function MyBookingsTab({
  bookings,
  onRefresh: _onRefresh,
  onSwitchToBook: _onSwitchToBook,
  onUpdateBooking,
  onPlayersAdded,
}: {
  bookings: Booking[];
  onRefresh: () => void;
  onSwitchToBook: () => void;
  onUpdateBooking: (bookingId: string, updates: Partial<Booking>) => void;
  onPlayersAdded: (rows: Booking[]) => void;
}) {
  const { user } = useProfile();
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [editTarget, setEditTarget] = useState<EditGuestTarget | null>(null);
  const [addTarget, setAddTarget] = useState<AddPlayerTarget | null>(null);
  const [surveyTarget, setSurveyTarget] = useState<SurveyTarget | null>(null);

  // Ratings this member has already given, so a rated round shows its score
  // instead of offering the form again. Scoped to the member explicitly: RLS
  // would also allow an admin to read every response, which this page has no
  // use for.
  const [ratings, setRatings] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    createClient()
      .from("booking_surveys")
      .select("booking_id, rating")
      .eq("member_id", user.id)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setRatings(new Map(data.map((r) => [r.booking_id as string, r.rating as number])));
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const now = new Date();
  const allGroups = groupBookings(bookings);
  const upcoming = allGroups.filter(
    (g) =>
      bookingToLocalDate(
        g.primary.booking_date,
        g.primary.tee_time,
        g.primary.course?.timezone,
      ) >= now && g.primary.status !== "cancelled",
  );
  const cancelledAndPast = allGroups
    .filter(
      (g) =>
        bookingToLocalDate(
          g.primary.booking_date,
          g.primary.tee_time,
          g.primary.course?.timezone,
        ) < now || g.primary.status === "cancelled",
    )
    .sort(
      (a, b) =>
        bookingToLocalDate(
          b.primary.booking_date,
          b.primary.tee_time,
          b.primary.course?.timezone,
        ).getTime() -
        bookingToLocalDate(
          a.primary.booking_date,
          a.primary.tee_time,
          a.primary.course?.timezone,
        ).getTime(),
    );

  return (
    <div className="px-5 md:px-8 py-5 pb-8 md:max-w-2xl md:mx-auto">
      <CancelModal
        open={!!cancelTarget}
        bookingDateTime={cancelTarget?.bookingDateTime ?? ""}
        title={cancelTarget?.title ?? "Cancel booking"}
        ghlBookingId={cancelTarget?.ghlBookingId ?? null}
        onDismiss={() => setCancelTarget(null)}
      />

      <EditGuestModal
        target={editTarget}
        onDismiss={() => setEditTarget(null)}
        onSaved={(bookingId, guestName, player) =>
          onUpdateBooking(bookingId, {
            guest_name: guestName,
            additional_players: [player],
          })
        }
      />

      <AddPlayerModal
        target={addTarget}
        onDismiss={() => setAddTarget(null)}
        onAdded={(rows) => {
          onPlayersAdded(rows);
          setAddTarget(null);
        }}
      />

      {/* Rate a past round on demand — the way rounds that finished before the
          survey existed (or that a member dismissed) still get a response. */}
      <BookingSurveySheet
        target={surveyTarget}
        onDismiss={() => setSurveyTarget(null)}
        onSubmitted={(bookingId, rating) => {
          // Reflect the new rating in place; the row swaps to its score.
          setRatings((prev) => new Map(prev).set(bookingId, rating));
          setSurveyTarget(null);
        }}
        dismissLabel="Cancel"
      />

      {upcoming.length === 0 && cancelledAndPast.length === 0 && (
        <EmptyState
          icon="🗓️"
          title="No bookings yet"
          description="Book your first round using the calendar above."
        />
      )}

      {upcoming.length > 0 && (
        <>
          <p className="section-label mb-3">Upcoming</p>
          <div className="space-y-2 mb-6">
            {upcoming.map((group) => (
              <BookingCard
                key={group.primary.id}
                group={group}
                userId={user?.id}
                onCancel={setCancelTarget}
                onEditGuest={setEditTarget}
                onAddPlayer={setAddTarget}
              />
            ))}
          </div>
        </>
      )}

      {cancelledAndPast.length > 0 && (
        <>
          <p className="section-label mb-3">Past &amp; Cancelled</p>
          <div className="space-y-1.5">
            {cancelledAndPast.map((group) => {
              const displayDate = new Date(
                `${group.primary.booking_date}T12:00:00`,
              );
              const displayTime = formatTeeTime(group.primary.tee_time);
              const courseName = group.primary.course?.name ?? "Golf course";
              const isCancelled = group.primary.status === "cancelled";
              const rating = ratings.get(group.primary.id);
              // Rateable once the round has actually finished — a cancelled or
              // never-confirmed booking was never a round to rate. The server
              // re-checks all of this on submit.
              const canRate =
                !isCancelled &&
                rating === undefined &&
                (SURVEYABLE_BOOKING_STATUSES as readonly string[]).includes(
                  group.primary.status,
                ) &&
                isSurveyDue(group.primary, group.primary.course, now);

              return (
                <div
                  key={group.primary.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                  style={{
                    background: "rgba(0,38,105,0.025)",
                    opacity: isCancelled ? 0.6 : 0.75,
                  }}
                >
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-medium truncate ${isCancelled ? "line-through" : ""}`}
                      style={{ color: "var(--color-green-900)" }}
                    >
                      {courseName}
                    </p>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "rgba(0,38,105,0.45)" }}
                    >
                      {format(displayDate, "EEE, MMM d, yyyy")} · {displayTime}
                    </p>
                  </div>
                  {isCancelled ? (
                    <BookingStatusBadge status="cancelled" />
                  ) : rating !== undefined ? (
                    <span
                      className="flex items-center gap-1 text-xs font-medium flex-shrink-0"
                      style={{ color: "rgba(0,38,105,0.45)" }}
                      aria-label={`You rated this round ${rating} out of 5`}
                    >
                      <Star className="w-3.5 h-3.5 text-gold fill-gold" strokeWidth={1.5} aria-hidden />
                      {rating}
                    </span>
                  ) : canRate ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSurveyTarget({
                          booking_id: group.primary.id,
                          booking_date: group.primary.booking_date,
                          tee_time: group.primary.tee_time,
                          course_name: courseName,
                        })
                      }
                      className="btn btn-outline btn-sm flex-shrink-0"
                    >
                      <Star className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
                      Rate round
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Booking card with player toggle ------------------------

function BookingCard({
  group,
  userId,
  onCancel,
  onEditGuest,
  onAddPlayer,
}: {
  group: BookingGroup;
  userId: string | undefined;
  onCancel: (target: CancelTarget) => void;
  onEditGuest: (target: EditGuestTarget) => void;
  onAddPlayer: (target: AddPlayerTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const iAmBooker = group.primary.member_id === userId;
  const activePlayers = group.players.filter((p) => p.status !== "cancelled");
  // For invited members the group now includes all sibling rows, so total = 1 (primary) + all players
  const totalPlayers = 1 + activePlayers.length;
  // localDt is a UTC-correct timestamp used ONLY for logic (hours-until, cancel modal).
  // For display use bookingDate / bookingTime to avoid browser-timezone shifting.
  const localDt = bookingToLocalDate(
    group.primary.booking_date,
    group.primary.tee_time,
    group.primary.course?.timezone,
  );
  const bookingDate = new Date(`${group.primary.booking_date}T12:00:00`);
  const bookingTime = formatTeeTime(group.primary.tee_time);
  const courseName = group.primary.course?.name ?? "Golf course";
  const hoursUntil = differenceInHours(localDt, new Date());
  // Cancel is only actionable once a booking has been confirmed/payment-ready —
  // pending (tentative/awaiting_approval) bookings cannot be cancelled yet.
  const CANCELLABLE = [
    "availability_confirmed",
    "payment_confirmed",
    "confirmed",
  ];
  const canCancelPrimary =
    hoursUntil > 0 && CANCELLABLE.includes(group.primary.status);
  // Only the booker can add players, and only to an upcoming, not-yet-full
  // round. This is independent of the booker's payment-due status — the FIFO
  // gate blocks new bookings, not expanding one you've already made.
  const MAX_GROUP_PLAYERS = 4;
  const canAddPlayers =
    iAmBooker &&
    hoursUntil > 0 &&
    group.primary.status !== "cancelled" &&
    totalPlayers < MAX_GROUP_PLAYERS;
  // All bookings (booker and invited) use the same collapsible card style.
  const canExpand = true;

  // ---- Build allRows -------------------------------------------------
  // Booker: "You" = primary row, full actions on all rows
  // Invited member: "You" = their own player row, can only cancel their own
  // Status labels are identical for both — same STATUS_LABELS throughout
  const allRows = iAmBooker
    ? [
        {
          id: group.primary.id,
          name: "You",
          status: group.primary.status,
          ghlBookingId: group.primary.ghl_booking_id ?? null,
          canCancel: canCancelPrimary,
          canPay: group.primary.status === "availability_confirmed",
          isYou: true,
          adminNotes: group.primary.admin_notes ?? null,
          editablePlayer: null as AdditionalPlayer | null,
        },
        ...activePlayers.map((p) => ({
          id: p.id,
          name: p.guest_name ?? "Guest",
          status: p.status,
          ghlBookingId: p.ghl_booking_id ?? null,
          canCancel: hoursUntil > 0 && CANCELLABLE.includes(p.status),
          canPay: p.status === "availability_confirmed",
          isYou: false,
          adminNotes: p.admin_notes ?? null,
          // Only a still-pending non-member guest can be corrected — once an
          // admin has set them up (or the row is cancelled/confirmed), GHL is
          // already involved and editing here would silently drift out of sync.
          editablePlayer:
            p.status === "awaiting_approval"
              ? (p.additional_players?.[0] ?? null)
              : null,
        })),
      ]
    : (() => {
        const myRow = group.players.find((p) => p.player_member_id === userId);
        const otherPlayers = activePlayers.filter((p) => p.id !== myRow?.id);
        return [
          {
            id: myRow?.id ?? group.primary.id,
            name: "You",
            status: myRow?.status ?? group.primary.status,
            ghlBookingId: myRow?.ghl_booking_id ?? null,
            canCancel: myRow
              ? hoursUntil > 0 && CANCELLABLE.includes(myRow.status)
              : false,
            canPay: myRow?.status === "availability_confirmed",
            isYou: true,
            adminNotes: myRow?.admin_notes ?? null,
            editablePlayer: null as AdditionalPlayer | null,
          },
          {
            id: group.primary.id,
            name: myRow?.booker_name ?? "Booker",
            status: group.primary.status,
            ghlBookingId: null,
            canCancel: false,
            canPay: false,
            isYou: false,
            adminNotes: group.primary.admin_notes ?? null,
            editablePlayer: null as AdditionalPlayer | null,
          },
          ...otherPlayers.map((p) => ({
            id: p.id,
            name: p.guest_name ?? "Guest",
            status: p.status,
            ghlBookingId: null,
            canCancel: false,
            editablePlayer: null as AdditionalPlayer | null,
            canPay: false,
            isYou: false,
            adminNotes: p.admin_notes ?? null,
          })),
        ];
      })();

  const hasPaymentDue = allRows.some((row) => row.canPay);

  return (
    <div
      className="rounded-2xl border bg-white overflow-hidden"
      style={{ borderColor: "rgba(0,38,105,0.08)" }}
    >
      {/* Main summary */}
      <div className="px-4 py-3">
        {/* Course + invited-by */}
        <p
          className="text-[10px] font-semibold uppercase tracking-wider truncate mb-1"
          style={{ color: "rgba(0,38,105,0.35)" }}
        >
          {courseName}
          {!iAmBooker && group.primary.booker_name && (
            <span
              className="normal-case tracking-normal ml-1.5 font-medium"
              style={{ color: "var(--color-green-700)" }}
            >
              · invited by {group.primary.booker_name}
            </span>
          )}
        </p>

        {/* Date · time · player toggle — all on one line */}
        <div className="flex items-center justify-between gap-2">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-green-900)" }}
          >
            {format(bookingDate, "EEE, MMM d")}
            <span
              className="font-normal ml-1.5"
              style={{ color: "rgba(0,38,105,0.45)" }}
            >
              · {bookingTime}
            </span>
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasPaymentDue && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{ background: "rgba(146,100,10,0.1)", color: "#92640a" }}
              >
                💳 Payment due
              </span>
            )}
            {canExpand && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium flex-shrink-0"
                style={{ color: "rgba(0,38,105,0.45)" }}
              >
                {totalPlayers}p
                <svg
                  className={cn(
                    "w-3 h-3 transition-transform duration-200",
                    expanded ? "rotate-180" : "",
                  )}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expandable players panel */}
      {canExpand && expanded && (
        <div
          className="border-t"
          style={{ borderColor: "rgba(0,38,105,0.06)" }}
        >
          {allRows.map((row, idx) => {
            const canPay = row.canPay;
            const editablePlayer = row.editablePlayer;
            return (
              <div
                key={row.id}
                className="flex items-center gap-2.5 px-4 py-2.5"
                style={{
                  borderTop:
                    idx === 0 ? "none" : "1px solid rgba(0,38,105,0.04)",
                }}
              >
                {/* Name + admin note indicator */}
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                  <span
                    className="text-xs font-medium truncate capitalize"
                    style={{ color: "var(--color-green-900)" }}
                  >
                    {row.name}
                  </span>
                  {row.adminNotes && (
                    <div className="relative group flex-shrink-0">
                      <span
                        title={row.adminNotes}
                        className="flex items-center justify-center w-4 h-4 rounded-full text-[10px] leading-none cursor-help flex-shrink-0"
                        style={{
                          background: "rgba(234,179,8,0.15)",
                          color: "#92640a",
                        }}
                        aria-label={`Admin note: ${row.adminNotes}`}
                      >
                        ⚠
                      </span>
                      <div
                        className="absolute left-0 bottom-full mb-1.5 hidden group-hover:block w-56 max-w-[70vw] rounded-lg px-3 py-2 text-[11px] leading-snug shadow-lg z-20"
                        style={{
                          background: "var(--color-green-900)",
                          color: "white",
                        }}
                      >
                        {row.adminNotes}
                      </div>
                    </div>
                  )}
                </div>

                {/* Status badge or Pay CTA */}
                {!canPay && <BookingStatusBadge status={row.status} />}
                {canPay &&
                  (group.primary.course?.payment_url ? (
                    <a
                      href={group.primary.course.payment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
                      style={{
                        background: "rgba(146,100,10,0.1)",
                        color: "#92640a",
                      }}
                    >
                      Pay →
                    </a>
                  ) : (
                    <span className="text-[11px] text-gray-400 flex-shrink-0">
                      Payment link pending
                    </span>
                  ))}

                {/* Edit — booker only, while the guest is still awaiting approval */}
                {editablePlayer && (
                  <button
                    type="button"
                    onClick={() =>
                      onEditGuest({
                        bookingId: row.id,
                        player: editablePlayer,
                      })
                    }
                    className="text-[11px] font-medium px-2 py-1 rounded-lg flex-shrink-0"
                    style={{
                      color: "rgba(0,38,105,0.55)",
                      background: "rgba(0,38,105,0.06)",
                    }}
                  >
                    Edit
                  </button>
                )}

                {/* Cancel */}
                {row.canCancel && (
                  <button
                    type="button"
                    onClick={() =>
                      onCancel({
                        bookingDateTime: localDt.toISOString(),
                        title: row.isYou
                          ? "Cancel my booking"
                          : `Cancel ${row.name}'s booking`,
                        ghlBookingId: row.ghlBookingId,
                      })
                    }
                    className="text-[11px] font-medium px-2 py-1 rounded-lg flex-shrink-0"
                    style={{
                      color: "rgba(220,38,38,0.65)",
                      background: "rgba(220,38,38,0.06)",
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            );
          })}

          {/* Add player — booker only, upcoming & not full */}
          {canAddPlayers && (
            <button
              type="button"
              onClick={() =>
                onAddPlayer({
                  bookingId: group.primary.id,
                  courseName,
                  dateLabel: format(bookingDate, "EEE, MMM d"),
                  timeLabel: bookingTime,
                  excludeMemberIds: [
                    group.primary.member_id,
                    ...activePlayers
                      .map((p) => p.player_member_id)
                      .filter((mid): mid is string => Boolean(mid)),
                  ],
                })
              }
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors border-t hover:bg-green-50"
              style={{
                borderColor: "rgba(0,38,105,0.06)",
                color: "var(--color-green-700)",
              }}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Add player
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Add player to an existing booking ----------------------

interface AddPlayerTarget {
  bookingId: string;
  courseName: string;
  dateLabel: string;
  timeLabel: string;
  excludeMemberIds: string[];
}

type AddPlayerForm = {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
};

function AddPlayerModal({
  target,
  onDismiss,
  onAdded,
}: {
  target: AddPlayerTarget | null;
  onDismiss: () => void;
  onAdded: (rows: Booking[]) => void;
}) {
  const { user } = useProfile();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [kind, setKind] = useState<PlayerKind>("member");
  const [selected, setSelected] = useState<MemberWithProfile | null>(null);
  // Selecting a member isn't a react-hook-form field, so its "required" error
  // is tracked separately; `submitError` holds server/network failures.
  const [memberError, setMemberError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    clearErrors,
    formState: { errors },
  } = useForm<AddPlayerForm>({
    defaultValues: { firstName: "", lastName: "", mobile: "", email: "" },
    // Validate on submit only; per-field errors then surface under each input
    // and re-validate as the user edits (RHF's default reValidateMode).
    mode: "onSubmit",
    // Non-member fields unmount when the Member tab is active — drop their
    // values/validation so a hidden field never blocks a member submit.
    shouldUnregister: true,
  });

  const open = !!target;

  const bookerEmail = (user?.email ?? "").trim().toLowerCase();

  // Per-field validators for the non-member inputs (return a string to surface
  // it as that field's error). Mirrors the create-booking flow's guest checks.
  function validateGuestEmail(v?: string): true | string {
    const val = (v ?? "").trim();
    if (!validateEmail(val).valid) return "Enter a valid email address";
    if (bookerEmail && val.toLowerCase() === bookerEmail)
      return "That's your email — you're already on this booking";
    return true;
  }
  function validateGuestPhone(v?: string): true | string {
    return isValidGuestPhone(v) ? true : "Enter a valid phone number";
  }

  useEffect(() => {
    if (open) {
      setMounted(true);
      setKind("member");
      setSelected(null);
      setMemberError("");
      setSubmitError("");
      reset({ firstName: "", lastName: "", mobile: "", email: "" });
      const ids: number[] = [];
      ids[0] = requestAnimationFrame(() => {
        ids[1] = requestAnimationFrame(() => setVisible(true));
      });
      return () => ids.forEach((id) => cancelAnimationFrame(id));
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.bookingId]);

  useEffect(() => {
    if (!open || members.length) return;
    fetch("/api/members?exclude_self=true")
      .then((r) => r.json())
      .then((d) => setMembers(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [open, members.length]);

  if (!mounted || !target) return null;

  const bookingId = target.bookingId;

  const inputCls =
    "w-full px-3 py-2 text-sm rounded-xl border bg-white outline-none transition-colors focus:border-green-700";
  const fieldStyle = {
    borderColor: "rgba(0,38,105,0.12)",
    color: "var(--color-green-900)",
  };
  const errFieldStyle = { ...fieldStyle, borderColor: "#dc2626" };

  function switchKind(k: PlayerKind) {
    if (k === kind) return;
    setKind(k);
    setSelected(null);
    setMemberError("");
    setSubmitError("");
    clearErrors();
    reset({ firstName: "", lastName: "", mobile: "", email: "" });
  }

  const onValid = async (values: AddPlayerForm) => {
    let player: AdditionalPlayer;
    if (kind === "member") {
      if (!selected) {
        setMemberError("Select a member to add.");
        return;
      }
      player = {
        firstName: selected.first_name,
        lastName: selected.last_name,
        email: selected.email,
        mobile: selected.phone ?? "",
        memberId: selected.id,
        isNonMember: false,
      };
    } else {
      player = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        mobile: values.mobile,
        isNonMember: true,
      };
    }

    setSubmitError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/players`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalPlayers: [player] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to add player. Please try again.");
        return;
      }
      onAdded(Array.isArray(data.bookings) ? (data.bookings as Booking[]) : []);
    } catch {
      setSubmitError("Network error. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Close"
        className={[
          "absolute inset-0 w-full h-full",
          visible ? "opacity-100" : "opacity-0",
        ].join(" ")}
        style={{
          background: "rgba(0,0,0,0.45)",
          transition: "opacity 200ms ease-out",
          willChange: "opacity",
        }}
        onClick={onDismiss}
      />
      <div
        className={[
          "relative bg-white rounded-t-3xl md:rounded-3xl px-5 pt-5 pb-8 space-y-4 w-full md:max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain",
          visible ? "translate-y-0" : "translate-y-full",
        ].join(" ")}
        style={{
          boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
          transition: visible
            ? "transform 340ms cubic-bezier(0.32,0.72,0,1)"
            : "transform 240ms cubic-bezier(0.4,0,1,1)",
          willChange: "transform",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p
            className="font-sans font-black text-lg"
            style={{ color: "var(--color-green-900)" }}
          >
            Add player
          </p>
          <button
            onClick={onDismiss}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{
              background: "rgba(0,38,105,0.06)",
              color: "rgba(0,38,105,0.5)",
            }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <p className="text-xs" style={{ color: "rgba(0,38,105,0.45)" }}>
          {target.courseName} · {target.dateLabel} · {target.timeLabel}
        </p>

        <form
          onSubmit={handleSubmit(onValid)}
          noValidate
          className="space-y-4"
        >
          {/* Member / Non-member toggle */}
          <div
            className="flex gap-1 p-1 rounded-xl"
            style={{ background: "rgba(0,38,105,0.05)" }}
          >
            {(
              [
                ["member", "Member"],
                ["non_member", "Non-member"],
              ] as [PlayerKind, string][]
            ).map(([k, label]) => {
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => switchKind(k)}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg transition-all"
                  style={
                    active
                      ? {
                          background: "white",
                          color: "var(--color-green-900)",
                          boxShadow: "0 1px 3px rgba(0,38,105,0.12)",
                        }
                      : { color: "rgba(0,38,105,0.5)" }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          {kind === "member" ? (
            selected ? (
              <div
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                style={{ background: "rgba(0,38,105,0.04)" }}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="text-sm font-medium truncate capitalize"
                    style={{ color: "var(--color-green-900)" }}
                  >
                    {selected.first_name} {selected.last_name}
                  </p>
                  <p
                    className="text-xs truncate"
                    style={{ color: "rgba(0,38,105,0.45)" }}
                  >
                    {selected.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs px-2 py-1 rounded-lg flex-shrink-0"
                  style={{
                    color: "rgba(0,38,105,0.45)",
                    background: "rgba(0,38,105,0.05)",
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div>
                <MemberAutocomplete
                  members={members}
                  excludeIds={target.excludeMemberIds}
                  onSelect={(m) => {
                    setSelected(m);
                    setMemberError("");
                  }}
                />
                {memberError && (
                  <p className="text-xs mt-1 text-red-600">{memberError}</p>
                )}
              </div>
            )
          ) : (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  {...register("firstName", {
                    maxLength: { value: 100, message: "Max 100 characters" },
                  })}
                  className={inputCls}
                  style={errors.firstName ? errFieldStyle : fieldStyle}
                  placeholder="First name (optional)"
                  autoComplete="off"
                />
                <input
                  {...register("lastName", {
                    maxLength: { value: 100, message: "Max 100 characters" },
                  })}
                  className={inputCls}
                  style={errors.lastName ? errFieldStyle : fieldStyle}
                  placeholder="Last name (optional)"
                  autoComplete="off"
                />
              </div>
              {(errors.firstName || errors.lastName) && (
                <p className="text-xs text-red-600">
                  {(errors.firstName || errors.lastName)?.message}
                </p>
              )}
              <div>
                <input
                  {...register("mobile", { validate: validateGuestPhone })}
                  type="tel"
                  inputMode="tel"
                  className={inputCls}
                  style={errors.mobile ? errFieldStyle : fieldStyle}
                  placeholder="Phone number (required)"
                  autoComplete="off"
                />
                {errors.mobile && (
                  <p className="text-xs mt-1 text-red-600">
                    {errors.mobile.message}
                  </p>
                )}
              </div>
              <div>
                <input
                  {...register("email", { validate: validateGuestEmail })}
                  type="email"
                  inputMode="email"
                  className={inputCls}
                  style={errors.email ? errFieldStyle : fieldStyle}
                  placeholder="Email (required)"
                  autoComplete="off"
                />
                {errors.email && (
                  <p className="text-xs mt-1 text-red-600">
                    {errors.email.message}
                  </p>
                )}
              </div>
              <p className="text-[11px]" style={{ color: "rgba(0,38,105,0.4)" }}>
                Non-member guests are confirmed by an admin.
              </p>
            </div>
          )}

          {submitError && (
            <p className="text-xs" style={{ color: "rgba(220,38,38,0.85)" }}>
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3.5 rounded-2xl text-sm font-semibold text-center disabled:opacity-60"
            style={{ background: "var(--color-green-900)", color: "white" }}
          >
            {saving ? "Adding…" : "Add player"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---- Event selection screen ---------------------------------

function EventSelectionScreen({
  onSelect,
  pendingBookings,
  loadingPendingBookings,
  refreshingPending,
}: {
  /** Venue, day and tee time all chosen at once — this goes to confirmation. */
  onSelect: (course: Course, date: string, slot: GHLBookingSlot) => void;
  pendingBookings: PendingPayment[];
  loadingPendingBookings: boolean;
  refreshingPending: boolean;
}) {
  // Every bookable venue, fetched once. The calendar plots availability, but
  // the venue's own details — price, address, rules, links — live on these
  // rows, so the detail sheet reads them from here rather than bloating the
  // month payload with a copy of each course.
  const [events, setEvents] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateFeed, setShowCreateFeed] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  // "" = any date. A date narrows the list to courses with a tee time open
  // that day, which the server answers by asking each course's calendar.
  const [dateFilter, setDateFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ---- Aggregated month calendar ----
  // The only way to browse: one month, every bookable venue on the day it has
  // tee times. It replaced a flat venue list, which could say which clubs
  // exist but never when any of them were free.
  const [calMonth, setCalMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [calVenues, setCalVenues] = useState<CalendarVenue[]>([]);
  const [calDays, setCalDays] = useState<Record<string, CalendarOpening[]>>({});
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState("");
  // null = every venue. A list narrows the month to just those clubs.
  const [calVenueFilters, setCalVenueFilters] = useState<string[] | null>(null);
  const [dayDetail, setDayDetail] = useState<VenueDayDetail | null>(null);

  const activeFilterCount =
    (locationFilter !== "all" ? 1 : 0) +
    (dateFilter ? 1 : 0) +
    (calVenueFilters !== null ? 1 : 0);

  // The day the calendar has open IS the date filter — one state, so the drawer
  // and the grid can't disagree about which day is showing. A date left over
  // from another month simply doesn't resolve to a cell in this one.
  const calSelectedDate =
    dateFilter && dateFilter.startsWith(format(calMonth, "yyyy-MM"))
      ? dateFilter
      : null;

  // Refetched per month.
  useEffect(() => {
    // A month's worth of availability fans out across every venue's calendar,
    // so a slower earlier month can land after a newer one. Ignore all but the
    // latest request.
    let current = true;
    setCalLoading(true);
    setCalError("");
    fetch(`/api/bookings/availability?month=${format(calMonth, "yyyy-MM")}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "Failed to load availability.");
        return d;
      })
      .then((d) => {
        if (!current) return;
        setCalVenues(Array.isArray(d.venues) ? d.venues : []);
        setCalDays(
          d.days && typeof d.days === "object"
            ? (d.days as Record<string, CalendarOpening[]>)
            : {},
        );
      })
      .catch(() => {
        if (!current) return;
        setCalVenues([]);
        setCalDays({});
        setCalError("Couldn't load the calendar. Check your connection and try again.");
      })
      .finally(() => {
        if (current) setCalLoading(false);
      });
    return () => {
      current = false;
    };
  }, [calMonth]);

  // Colours are assigned over the whole month's venue list, exactly as the grid
  // does it, so a chip in the drawer matches its dots on the calendar.
  //
  // The chips themselves respect the search and location above them — offering
  // a club in another city while a location filter is on would list a choice
  // that resolves to an empty month. The active focus is always kept, so it
  // never becomes an applied filter with no visible way back.
  const calVenueOptions = useMemo(() => {
    const colours = buildVenueColours(calVenues.map((v) => v.id));
    const q = debouncedSearch.trim().toLowerCase();
    return calVenues
      .filter(
        (v) =>
          calVenueFilters?.includes(v.id) ||
          ((!q || v.name.toLowerCase().includes(q)) &&
            (locationFilter === "all" ||
              [v.city, v.state].filter(Boolean).join(", ") === locationFilter)),
      )
      .map((v) => ({
        id: v.id,
        name: v.name,
        colourIdx: colours.get(v.id) ?? 0,
      }));
  }, [calVenues, debouncedSearch, locationFilter, calVenueFilters]);

  // Search, location and venue focus all narrow the same thing — which venues
  // the month plots — so they're resolved to one allow-list here rather than
  // three rules inside the grid. null means nothing is narrowing.
  const calAllowedVenueIds = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q && locationFilter === "all" && calVenueFilters === null) return null;
    return calVenues
      .filter((v) => !q || v.name.toLowerCase().includes(q))
      .filter(
        (v) =>
          locationFilter === "all" ||
          [v.city, v.state].filter(Boolean).join(", ") === locationFilter,
      )
      .filter((v) => calVenueFilters === null || calVenueFilters.includes(v.id))
      .map((v) => v.id);
  }, [calVenues, debouncedSearch, locationFilter, calVenueFilters]);

  const clearVenueFilters = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setLocationFilter("all");
    setCalVenueFilters(null);
  }, []);

  // The drawer's date field doubles as "jump to this day", so a date outside
  // the visible month brings its month along with it.
  const handleDateFilterChange = useCallback((d: string) => {
    setDateFilter(d);
    if (d) setCalMonth(startOfMonth(new Date(`${d}T12:00:00`)));
  }, []);

  // A venue only appears in the calendar if it's bookable, so it's always in
  // `events` too — but guard anyway rather than open an empty sheet.
  const openDayDetail = useCallback(
    (courseId: string, date: string) => {
      const course = events.find((e) => e.id === courseId);
      const opening = (calDays[date] ?? []).find((o) => o.courseId === courseId);
      if (!course || !opening) return;
      setDayDetail({
        course,
        date,
        openSlots: opening.openSlots,
        openSpots: opening.openSpots,
        // The FIFO gate is global — any unpaid round blocks a new booking at
        // every venue — so this is the whole pending list, not this course's.
        pendingCount: pendingBookings.length,
      });
    },
    [events, calDays, pendingBookings],
  );

  useEffect(() => {
    fetch("/api/courses")
      .then(async (r) => {
        if (!r.ok) throw new Error("Failed to load courses.");
        return r.json();
      })
      .then((d) => {
        setEvents(Array.isArray(d.courses) ? d.courses : []);
      })
      .catch(() => setError("Failed to load courses."))
      .finally(() => setLoading(false));
  }, []);

  // Debounce the search box so it doesn't hit the server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const eventLocation = (e: Course) =>
    [e.city, e.state].filter(Boolean).join(", ");

  const locationOptions = useMemo(() => {
    const map = new Map<
      string,
      { city: string | null; state: string | null }
    >();
    events.forEach((e) => {
      if (!e.city && !e.state) return;
      const label = eventLocation(e);
      if (!map.has(label)) map.set(label, { city: e.city, state: e.state });
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);
  const locations = useMemo(
    () => locationOptions.map(([label]) => label),
    [locationOptions],
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Spinner className="text-green-700 w-6 h-6" />
        <p className="text-sm" style={{ color: "rgba(0,38,105,0.4)" }}>
          Loading events…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="px-5 md:px-8 pt-5">
        <EmptyState
          icon="⛳"
          title="No courses available"
          description="There are no active courses linked to your membership right now."
          action={
            <button
              type="button"
              onClick={() => setShowCreateFeed(true)}
              className="text-sm font-semibold underline underline-offset-2"
              style={{ color: "var(--color-green-700)" }}
            >
              Click here to create a feed
            </button>
          }
        />
        {showCreateFeed && (
          <CreateFeedDialog onClose={() => setShowCreateFeed(false)} />
        )}
      </div>
    );
  }

  return (
    // The month grid needs room for venue names inside its cells.
    <div className="pb-8 md:mx-auto md:max-w-4xl">
      {/* The FIFO gate blocks booking anywhere, so its "Pay →" links belong on
          the screen where booking now begins. */}
      {loadingPendingBookings ? (
        <div
          className="mx-5 md:mx-8 mt-3 h-16 rounded-2xl animate-pulse"
          style={{ background: "rgba(0,38,105,0.04)" }}
        />
      ) : (
        pendingBookings.length > 0 && (
          <PendingPaymentBanner
            pending={pendingBookings}
            refreshing={refreshingPending}
          />
        )
      )}

      <div className="px-5 md:px-8 pt-5 pb-1 flex items-center gap-2">
        <div
          className="flex items-center gap-2 flex-1 min-w-0 bg-white rounded-xl px-3 py-2.5 border"
          style={{ borderColor: "rgba(0,38,105,0.1)" }}
        >
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            style={{ color: "rgba(0,38,105,0.32)" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="search"
            placeholder="Search by event name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-0 bg-transparent text-sm outline-none"
            style={{ color: "var(--color-green-900)" }}
          />
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-label="Filter events"
          className="relative flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl border transition-colors hover:bg-green-50/60 active:opacity-70"
          style={{
            borderColor: "rgba(0,38,105,0.1)",
            background: "white",
            color: "rgba(0,38,105,0.5)",
          }}
        >
          <FunnelIcon />
          {activeFilterCount > 0 && (
            <span
              className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white"
              style={{ background: "var(--color-gold)" }}
            />
          )}
        </button>
      </div>

      <div className="px-5 md:px-8 pt-2">
        {calError ? (
          <div className="card card-pad text-center py-10">
            <p className="text-sm text-red-500">{calError}</p>
            <button
              type="button"
              onClick={() => setCalMonth((m) => new Date(m))}
              className="btn btn-outline btn-sm mt-4 mx-auto"
            >
              Try again
            </button>
          </div>
        ) : (
          <VenueAvailabilityCalendar
            month={calMonth}
            venues={calVenues}
            days={calDays}
            loading={calLoading}
            selectedDate={calSelectedDate}
            onSelectDate={(d) => setDateFilter(d ?? "")}
            onMonthChange={setCalMonth}
            canGoPrev={calMonth > startOfMonth(new Date())}
            allowedVenueIds={calAllowedVenueIds}
            onClearVenueFilters={
              calAllowedVenueIds === null ? null : clearVenueFilters
            }
            onPickOpening={openDayDetail}
          />
        )}

        <VenueDayDetailSheet
          detail={dayDetail}
          onClose={() => setDayDetail(null)}
          onBook={(course, date, slot) => {
            setDayDetail(null);
            onSelect(course, date, slot);
          }}
        />
      </div>

      <EventFiltersDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        locations={locations}
        location={locationFilter}
        onLocationChange={setLocationFilter}
        date={dateFilter}
        onDateChange={handleDateFilterChange}
        venues={calVenueOptions}
        venueFilters={calVenueFilters}
        onVenueFiltersChange={setCalVenueFilters}
      />
    </div>
  );
}

function FunnelIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4.5h18M6 9h12M9.75 13.5h4.5M11.25 18h1.5"
      />
    </svg>
  );
}

function EventFiltersDrawer({
  open,
  onClose,
  locations,
  location,
  onLocationChange,
  date,
  onDateChange,
  venues = [],
  venueFilters = null,
  onVenueFiltersChange,
}: {
  open: boolean;
  onClose: () => void;
  locations: string[];
  location: string;
  onLocationChange: (location: string) => void;
  date: string;
  onDateChange: (date: string) => void;
  /**
   * Venues on the calendar this month, with the colour index the grid gave
   * them, so a chip here reads as the same club as its dots over there.
   */
  venues?: { id: string; name: string; colourIdx: number }[];
  /** Selected venue ids, or null for "all" — the canonical form of everything
   *  being on, so an untouched filter and a fully-ticked one are one state. */
  venueFilters?: string[] | null;
  onVenueFiltersChange?: (courseIds: string[] | null) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const ids: number[] = [];
      ids[0] = requestAnimationFrame(() => {
        ids[1] = requestAnimationFrame(() => setVisible(true));
      });
      return () => ids.forEach((id) => cancelAnimationFrame(id));
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!mounted) return null;

  // Selecting a filter no longer closes the sheet — with more than one to set,
  // closing on the first pick made the second unreachable without reopening.
  const today = format(new Date(), "yyyy-MM-dd");
  const hasFilters = location !== "all" || !!date || venueFilters !== null;
  // Picking among a single venue would change nothing.
  const venuePickable = venues.length > 1 && !!onVenueFiltersChange;

  // null means every venue is on, so an untouched filter shows every chip lit
  // rather than every chip dark with only "All venues" selected.
  const venueOn = (id: string) => venueFilters === null || venueFilters.includes(id);
  const allVenuesOn = venues.every((v) => venueOn(v.id));

  function toggleVenue(id: string) {
    const base = venueFilters ?? venues.map((v) => v.id);
    const next = base.includes(id)
      ? base.filter((x) => x !== id)
      : [...base, id];
    // Ticking the last one back on is "all" again — normalise so the filter
    // badge clears and the state can't drift into an equivalent-but-different
    // representation of the same thing.
    onVenueFiltersChange?.(
      venues.every((v) => next.includes(v.id)) ? null : next,
    );
  }

  const drawer = (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close filters"
        className="absolute inset-0 w-full h-full"
        style={{
          background: "rgba(0,0,0,0.4)",
          opacity: visible ? 1 : 0,
          transition: "opacity 200ms ease-out",
        }}
        onClick={onClose}
      />
      {/* transform lives on this element only — no overflow/clip here, to avoid
          iOS Safari clipping the sheet mid-animation */}
      <div
        className="relative"
        style={{
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: visible
            ? "transform 280ms cubic-bezier(0.32,0.72,0,1)"
            : "transform 200ms cubic-bezier(0.4,0,1,1)",
        }}
      >
        {/* inner element owns sizing/clipping; dvh + safe-area keep the last
            chips reachable above iOS browser chrome and the home indicator */}
        <div className="bg-white rounded-t-2xl flex flex-col max-h-[75dvh] overflow-hidden">
          <div className="flex-shrink-0 flex items-center justify-between px-5 pt-4 mb-4">
            <h2
              className="text-sm font-bold"
              style={{ color: "var(--color-green-900)" }}
            >
              Filters
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{
                background: "rgba(0,38,105,0.06)",
                color: "rgba(0,38,105,0.5)",
              }}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div
            className="flex-1 overflow-y-auto px-5"
            style={{
              paddingBottom: "max(2rem, calc(2rem + env(safe-area-inset-bottom)))",
            }}
          >
            <div className="mb-6">
              <p
                className="text-xs font-semibold mb-2.5"
                style={{ color: "rgba(0,38,105,0.45)" }}
              >
                Date
              </p>
              <input
                type="date"
                className="input w-full"
                min={today}
                value={date}
                onChange={(e) => onDateChange(e.target.value)}
                aria-label="Show venues with tee times on this date"
              />
              <p
                className="text-xs mt-2"
                style={{ color: "rgba(0,38,105,0.4)" }}
              >
                Jumps the calendar to that day and lists what&apos;s open.
              </p>
            </div>

            {locations.length > 1 && (
              <div>
                <p
                  className="text-xs font-semibold mb-2.5"
                  style={{ color: "rgba(0,38,105,0.45)" }}
                >
                  Location
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onLocationChange("all")}
                    className={`chip ${location === "all" ? "active" : ""}`}
                  >
                    All locations
                  </button>
                  {locations.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => onLocationChange(loc)}
                      className={`chip ${location === loc ? "active" : ""}`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {venuePickable && (
              <div className="mt-6">
                <p
                  className="text-xs font-semibold mb-2.5"
                  style={{ color: "rgba(0,38,105,0.45)" }}
                >
                  Venue
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={allVenuesOn}
                    onClick={() => onVenueFiltersChange?.(null)}
                    className={`chip ${allVenuesOn ? "active" : ""}`}
                  >
                    All venues
                  </button>
                  {venues.map((v) => {
                    const on = venueOn(v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleVenue(v.id)}
                        className={`chip ${on ? "active" : ""} flex items-center gap-1.5`}
                      >
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full flex-shrink-0",
                            on ? "bg-white" : VENUE_DOT[v.colourIdx],
                          )}
                        />
                        {v.name}
                      </button>
                    );
                  })}
                </div>
                <p
                  className="text-xs mt-2"
                  style={{ color: "rgba(0,38,105,0.4)" }}
                >
                  {allVenuesOn
                    ? "Every club is showing. Tap one to narrow the month."
                    : "Tap to add or remove clubs from the month."}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-6">
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    onLocationChange("all");
                    onDateChange("");
                    onVenueFiltersChange?.(null);
                  }}
                  className="flex-1 py-3 rounded-2xl text-sm font-semibold border"
                  style={{
                    borderColor: "rgba(0,38,105,0.12)",
                    color: "rgba(0,38,105,0.55)",
                  }}
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-2xl text-sm font-semibold text-center"
                style={{ background: "var(--color-green-900)", color: "white" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Portal to document.body so the fixed sheet is never clipped by the
  // .screen-content scroll container (iOS Safari) or trapped behind the nav
  return createPortal(drawer, document.body);
}

// ---- Create Feed Dialog ------------------------------------

function CreateFeedDialog({ onClose }: { onClose: () => void }) {
  const [feedName, setFeedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = feedName.trim();
    if (!name) {
      setErr("Please enter a name for the feed.");
      return;
    }
    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch("/api/focus-linkups/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry_focus: name, custom_label: name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setErr("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl px-6 pt-6 pb-8 shadow-2xl">
        {/* Drag handle — mobile only */}
        <div className="flex justify-center mb-5 sm:hidden">
          <div
            className="w-10 h-1 rounded-full"
            style={{ background: "rgba(0,38,105,0.12)" }}
          />
        </div>

        {submitted ? (
          <div className="text-center py-4">
            <p className="text-3xl mb-3">✅</p>
            <p
              className="font-sans font-black text-lg mb-2"
              style={{ color: "var(--color-green-900)" }}
            >
              Feed requested!
            </p>
            <p className="text-sm mb-6" style={{ color: "rgba(0,38,105,0.5)" }}>
              Our team will review your request and get in touch.
            </p>
            <button type="button" onClick={onClose} className="btn btn-primary">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <h2
              className="font-sans font-black text-xl mb-1"
              style={{ color: "var(--color-green-900)" }}
            >
              Create New Feed
            </h2>
            <p className="text-sm mb-5" style={{ color: "rgba(0,38,105,0.5)" }}>
              Request a new course or event feed. Our team will review and
              activate it for your membership.
            </p>

            <label
              htmlFor="new-feed-name"
              className="block text-xs font-semibold mb-1.5"
              style={{ color: "rgba(0,38,105,0.55)" }}
            >
              Feed name
            </label>
            <input
              id="new-feed-name"
              autoFocus
              className="input w-full text-sm mb-1.5"
              placeholder="e.g. Weekend Scramble, Corporate Golf Series…"
              value={feedName}
              onChange={(e) => {
                setFeedName(e.target.value);
                setErr("");
              }}
              disabled={submitting}
            />
            {err && <p className="text-xs text-red-500 mb-3">{err}</p>}

            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-outline flex-1 justify-center"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !feedName.trim()}
                className="btn btn-primary flex-1 justify-center disabled:opacity-50"
              >
                {submitting ? "Requesting…" : "Request feed"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  // Portal to document.body so fixed positioning is never clipped by a parent stacking context
  if (!mounted) return null;
  return createPortal(dialog, document.body);
}

// ---- Shared -----------------------------------------------
