"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useProfile } from "@/hooks/useProfile";
import { apiClient } from "@/lib/api-client";
import AppShell from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui/Loading";
import EmptyState from "@/components/ui/EmptyState";
import { formatTeeTime, cn } from "@/lib/utils";
import {
  format,
  parse,
  addDays,
  addHours,
  addMonths,
  differenceInHours,
  getDaysInMonth,
  startOfMonth,
} from "date-fns";
import type { Booking, GHLBookingSlot, AdditionalPlayer } from "@/types";

type Step = "select" | "confirm" | "success";

const BOOKING_MIN_DAYS = 0;

const FALLBACK_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function getAllTimezones(): string[] {
  try {
    const all = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (all && all.length > 0) return all;
  } catch {
    /* ignore */
  }
  return FALLBACK_TIMEZONES;
}

function formatSlotTime(isoString: string): string {
  return formatTeeTime(isoString.split("T")[1]?.slice(0, 8) ?? "");
}

function slotEndTime(startIso: string, hours: number): string {
  const timeStr = startIso.split("T")[1]?.slice(0, 8) ?? "00:00:00";
  return format(
    addHours(parse(timeStr, "HH:mm:ss", new Date()), hours),
    "h:mm a",
  );
}

export default function BookPage() {
  const { user } = useProfile();

  const today = useMemo(() => new Date(), []);

  // Timezone — default to user's browser timezone
  const [timezone, setTimezone] = useState<string>(getBrowserTimezone);
  const timezones = useMemo(getAllTimezones, []);

  // Month navigation — start at the month containing the first bookable date
  const [currentMonth, setCurrentMonth] = useState<Date>(() =>
    startOfMonth(addDays(new Date(), BOOKING_MIN_DAYS)),
  );

  // Slots keyed by YYYY-MM-DD
  const [monthSlots, setMonthSlots] = useState<
    Record<string, GHLBookingSlot[]>
  >({});
  const [loadingMonth, setLoadingMonth] = useState(false);

  // Selection — preselect today on load
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd"),
  );
  const [selectedSlot, setSelectedSlot] = useState<GHLBookingSlot | null>(null);

  // Booking flow
  const [step, setStep] = useState<Step>("select");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmedBooking, setConfirmedBooking] = useState<{
    date: string;
    time: string;
    players: number;
  } | null>(null);

  // My bookings tab
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [activeTab, setActiveTab] = useState<"book" | "myBookings">("book");

  const fetchMonthSlots = useCallback(async () => {
    setLoadingMonth(true);
    setSelectedSlot(null);
    // When navigating to a different month, default to today if it falls in that
    // month, otherwise clear so the user picks a new date.
    const monthStr = format(currentMonth, "yyyy-MM");
    setSelectedDate((prev) => {
      if (prev.startsWith(monthStr)) return prev;
      const todayInThisMonth = format(new Date(), "yyyy-MM-dd").startsWith(
        monthStr,
      );
      return todayInThisMonth ? format(new Date(), "yyyy-MM-dd") : "";
    });
    try {
      const res = await fetch(
        `/api/bookings/create?month=${monthStr}&timezone=${encodeURIComponent(timezone)}`,
      );
      const data = await res.json();
      setMonthSlots(data.slots ?? {});
    } catch {
      setMonthSlots({});
    }
    setLoadingMonth(false);
  }, [currentMonth, timezone]);

  useEffect(() => {
    fetchMonthSlots();
  }, [fetchMonthSlots]);
  useEffect(() => {
    if (user) loadMyBookings();
  }, [user]);

  // These must stay above the early returns to satisfy the rules of hooks
  const todayStr = useMemo(() => format(today, "yyyy-MM-dd"), [today]);
  const firstInWindowRef = useRef<HTMLButtonElement>(null);
  const selectedDateRef = useRef<HTMLButtonElement>(null);
  const firstInWindowDateStr = useMemo(() => {
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    const days = getDaysInMonth(currentMonth);
    for (let d = 1; d <= days; d++) {
      const dateStr = format(new Date(y, m, d), "yyyy-MM-dd");
      if (dateStr >= format(today, "yyyy-MM-dd")) return dateStr;
    }
    return null;
  }, [currentMonth, today]);
  useEffect(() => {
    if (loadingMonth || step !== "select" || activeTab !== "book") return;
    // Prefer scrolling to the selected date; fall back to first bookable date
    const target = selectedDateRef.current ?? firstInWindowRef.current;
    target?.scrollIntoView({ behavior: "instant", block: "nearest", inline: "start" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMonth, step, activeTab]);

  async function loadMyBookings() {
    const response = await apiClient.get<Booking[]>("/api/bookings");
    setMyBookings(response.data ?? []);
  }

  async function submitBooking(additionalPlayers: AdditionalPlayer[]) {
    if (!selectedSlot || !user || !selectedDate) return;
    setSubmitting(true);
    setError("");

    const timeStr = selectedSlot.startTime.split("T")[1]?.slice(0, 8) ?? "";

    const res = await fetch("/api/bookings/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: selectedDate,
        teeTime: timeStr,
        players: 1 + additionalPlayers.length,
        additionalPlayers,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      setConfirmedBooking({
        date: format(new Date(selectedDate + "T12:00:00"), "EEEE, MMMM d"),
        time: formatSlotTime(selectedSlot.startTime),
        players: 1 + additionalPlayers.length,
      });
      setStep("success");
      loadMyBookings();
    } else {
      setError(data.error ?? "Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  if (step === "success" && confirmedBooking) {
    return (
      <SuccessScreen
        booking={confirmedBooking}
        onDone={() => {
          setStep("select");
          setSelectedSlot(null);
        }}
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
        onBack={() => setStep("select")}
      />
    );
  }

  // ---- Calendar helpers ----
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = getDaysInMonth(currentMonth);

  const minMonthStr = format(
    startOfMonth(addDays(today, BOOKING_MIN_DAYS)),
    "yyyy-MM",
  );
  const currentMonthStr = format(currentMonth, "yyyy-MM");
  const canGoPrev = currentMonthStr > minMonthStr;
  const canGoNext = true;

  function getDateStr(day: number) {
    return format(new Date(year, month, day), "yyyy-MM-dd");
  }

  function hasDaySlots(day: number): boolean {
    return (monthSlots[getDateStr(day)] ?? []).some(
      (s) => (s.spotsOpen ?? 0) > 0,
    );
  }

  // All days of the month as Date objects (for display)
  const monthDays = Array.from(
    { length: daysInMonth },
    (_, i) => new Date(year, month, i + 1),
  );

  const selectedDateSlots = selectedDate
    ? (monthSlots[selectedDate] ?? [])
    : [];

  return (
    <AppShell title="Book" description="Park Hyatt Aviara">
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
        <div className="pb-8">
          {/* Timezone selector */}
          <div className="px-5 pt-4 pb-1 flex items-center gap-2">
            <span
              className="text-xs flex-shrink-0"
              style={{ color: "rgba(0,38,105,0.4)" }}
            >
              Timezone
            </span>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="flex-1 min-w-0 text-xs py-1.5 px-2.5 rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-green-900/20 truncate"
              style={{
                borderColor: "rgba(0,38,105,0.1)",
                color: "var(--color-green-900)",
              }}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Month navigation */}
          <div className="px-5 pt-3 pb-2 flex items-center justify-between">
            <button
              onClick={() => setCurrentMonth((m) => addMonths(m, -1))}
              disabled={!canGoPrev}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity disabled:opacity-20"
              style={{ background: "rgba(0,38,105,0.05)" }}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                style={{ color: "var(--color-green-900)" }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </button>

            <p
              className="font-sans font-black text-lg"
              style={{ color: "var(--color-green-900)" }}
            >
              {format(currentMonth, "MMMM yyyy")}
            </p>

            <button
              onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
              disabled={!canGoNext}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity disabled:opacity-20"
              style={{ background: "rgba(0,38,105,0.05)" }}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                style={{ color: "var(--color-green-900)" }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
            </button>
          </div>

          {/* Date pill strip */}
          <div className="px-5 pb-3">
            {loadingMonth ? (
              <div className="flex justify-center py-10">
                <Spinner className="text-green-700" />
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
                {monthDays.map((date) => {
                  const day = date.getDate();
                  const dateStr = getDateStr(day);
                  const isPast = dateStr < todayStr;
                  const isToday = dateStr === todayStr;
                  const inView = !isPast;
                  const hasSlots = hasDaySlots(day);
                  const active = selectedDate === dateStr;

                  // Today (regardless of slots) stays clickable; everything else
                  // requires slots to be clickable.
                  const canClick = isToday || (inView && hasSlots);

                  return (
                    <button
                      key={dateStr}
                      ref={
                        dateStr === selectedDate
                          ? selectedDateRef
                          : dateStr === firstInWindowDateStr
                            ? firstInWindowRef
                            : undefined
                      }
                      onClick={
                        canClick
                          ? () => {
                              setSelectedDate(dateStr);
                              setSelectedSlot(null);
                            }
                          : undefined
                      }
                      disabled={!canClick}
                      className={cn(
                        "flex-shrink-0 flex flex-col items-center px-3 py-3 rounded-2xl border min-w-[56px] transition-all duration-150",
                        !canClick && !isToday && "cursor-not-allowed",
                        isPast || !inView
                          ? "opacity-50"
                          : !hasSlots && "opacity-60",
                        active
                          ? "border-green-900"
                          : "bg-white border-green-900/08",
                      )}
                      style={
                        active
                          ? {
                              background: "var(--color-green-900)",
                              opacity: hasSlots ? 1 : 0.45,
                            }
                          : {}
                      }
                    >
                      <span
                        className="text-[10px] uppercase tracking-wider font-medium"
                        style={{
                          color: active
                            ? "rgba(133,187,101,0.8)"
                            : "rgba(0,38,105,0.38)",
                        }}
                      >
                        {format(date, "EEE")}
                      </span>
                      <span
                        className="font-sans font-black text-2xl mt-0.5"
                        style={{
                          color: active ? "white" : "var(--color-green-900)",
                        }}
                      >
                        {format(date, "d")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tee time slots for selected date */}
          {selectedDate && !loadingMonth && (
            <div className="px-5 pt-5">
              <p className="section-label mb-3">
                Tee times —{" "}
                {format(new Date(selectedDate + "T12:00:00"), "EEE, MMM d")}
              </p>

              {selectedDateSlots.length === 0 ? (
                <EmptyState
                  icon="⛳"
                  title="No tee times"
                  description="No open slots for this date."
                />
              ) : (
                <div className="space-y-2">
                  {selectedDateSlots.map((slot) => (
                    <SlotRow
                      key={slot.startTime}
                      slot={slot}
                      selected={selectedSlot?.startTime === slot.startTime}
                      onSelect={() => setSelectedSlot(slot)}
                      onContinue={() => setStep("confirm")}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <p
            className="text-xs text-center mt-6 px-5 leading-relaxed"
            style={{ color: "rgba(0,38,105,0.25)" }}
          >
            Select a date and tee time to submit a booking request.
            <br />
            Availability is confirmed by the team — payment link sent by email.
          </p>
        </div>
      ) : (
        <MyBookingsTab bookings={myBookings} onRefresh={loadMyBookings} />
      )}
    </AppShell>
  );
}

// ---- Slot row -----------------------------------------------

function SlotRow({
  slot,
  selected,
  onSelect,
  onContinue,
}: {
  slot: GHLBookingSlot;
  selected: boolean;
  onSelect: () => void;
  onContinue: () => void;
}) {
  const full = !slot.available || (slot.spotsOpen ?? 0) === 0;

  return (
    <button
      onClick={full ? undefined : selected ? onContinue : onSelect}
      disabled={full}
      className={cn(
        "w-full flex items-center justify-between px-5 py-4 rounded-2xl border transition-all duration-150 text-left",
        full
          ? "opacity-40 cursor-not-allowed"
          : selected
            ? ""
            : "bg-white hover:border-green-900/20",
      )}
      style={
        full
          ? {
              background: "rgba(0,38,105,0.03)",
              borderColor: "rgba(0,38,105,0.06)",
            }
          : selected
            ? {
                background: "rgba(133,187,101,0.06)",
                borderColor: "var(--color-gold)",
                boxShadow: "0 0 0 1px var(--color-gold)",
              }
            : { borderColor: "rgba(0,38,105,0.09)" }
      }
    >
      <div>
        <span
          className="font-sans font-black text-2xl"
          style={{ color: "var(--color-green-900)" }}
        >
          {formatSlotTime(slot.startTime)}
        </span>
        <p className="text-xs mt-0.5" style={{ color: "rgba(0,38,105,0.42)" }}>
          Until ~{slotEndTime(slot.startTime, 5)}
          {!full && (
            <span
              style={{
                color:
                  (slot.spotsOpen ?? 0) <= 3
                    ? "#92640a"
                    : "rgba(0,38,105,0.42)",
              }}
            >
              {" · "}
              {slot.spotsOpen} spot{slot.spotsOpen !== 1 ? "s" : ""} open
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
        {full ? (
          <span className="text-xs" style={{ color: "rgba(0,38,105,0.35)" }}>
            Full
          </span>
        ) : selected ? (
          <>
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--color-gold-dark)" }}
            >
              Book
            </span>
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              style={{ color: "var(--color-gold-dark)" }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
          </>
        ) : (
          <svg
            className="w-4 h-4 opacity-20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            style={{ color: "var(--color-green-900)" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 4.5l7.5 7.5-7.5 7.5"
            />
          </svg>
        )}
      </div>
    </button>
  );
}

// ---- Confirmation screen ------------------------------------

type PlayersForm = { players: AdditionalPlayer[] }

const PHONE_RE = /^[+]?[\d][\d\s\-()+.]{6,19}$/

function ConfirmScreen({
  slot,
  date,
  timezone,
  error,
  submitting,
  onSubmit,
  onBack,
}: {
  slot: GHLBookingSlot;
  date: string;
  timezone: string;
  error: string;
  submitting: boolean;
  onSubmit: (additionalPlayers: AdditionalPlayer[]) => void;
  onBack: () => void;
}) {
  const maxAdditional = Math.max(0, (slot.spotsOpen ?? 1) - 1);
  const [collapsed, setCollapsed] = useState<boolean[]>([]);

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<PlayersForm>({
    defaultValues: { players: [] },
    mode: "onChange",
  });

  const { fields, append, remove } = useFieldArray({ control, name: "players" });
  const watchedPlayers = watch("players");

  function addPlayer() {
    if (fields.length >= maxAdditional) return;
    append({ firstName: "", lastName: "", mobile: "", email: "" });
    setCollapsed((prev) => [...prev, false]);
  }

  function removePlayer(i: number) {
    remove(i);
    setCollapsed((prev) => prev.filter((_, idx) => idx !== i));
  }

  function toggleCollapsed(i: number) {
    setCollapsed((prev) => prev.map((c, idx) => (idx === i ? !c : c)));
  }

  function playerLabel(i: number): string {
    const p = watchedPlayers[i];
    if (!p) return `Player ${i + 2}`;
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    if (name) return name;
    if (p.email) return p.email;
    return `Player ${i + 2}`;
  }

  const inputBase =
    "w-full px-3 py-2 text-sm rounded-xl border bg-white outline-none transition-colors focus:border-green-700";
  const inputStyle = { borderColor: "rgba(0,38,105,0.12)", color: "var(--color-green-900)" };
  const errStyle = { borderColor: "rgba(220,38,38,0.5)" };

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

      <form onSubmit={handleSubmit((data) => onSubmit(data.players))} noValidate>
      <div className="px-5 py-6 space-y-5">
        {/* Booking hero */}
        <div className="card p-5">
          <p
            className="text-xs uppercase tracking-widest mb-3"
            style={{ color: "rgba(0,38,105,0.35)", letterSpacing: "0.12em" }}
          >
            Park Hyatt Aviara
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
          <p className="text-sm mt-1.5" style={{ color: "rgba(0,38,105,0.6)" }}>
            {format(new Date(date + "T12:00:00"), "EEEE, MMMM d, yyyy")}
          </p>
          <div
            className="flex items-center gap-3 mt-3 pt-3 border-t"
            style={{ borderColor: "rgba(0,38,105,0.07)" }}
          >
            <span className="text-xs" style={{ color: "rgba(0,38,105,0.38)" }}>
              {timezone.replace(/_/g, " ")}
            </span>
            <span style={{ color: "rgba(0,38,105,0.18)" }}>·</span>
            <span className="text-xs" style={{ color: "rgba(0,38,105,0.38)" }}>
              $160 per player
            </span>
          </div>
        </div>

        {/* Players */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">Players</p>
            <span className="text-xs" style={{ color: "rgba(0,38,105,0.35)" }}>
              {1 + fields.length} / {1 + maxAdditional} spots
            </span>
          </div>

          {/* Booking member (you) */}
          <div className="card px-4 py-3 mb-2 flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: "rgba(133,187,101,0.15)", color: "var(--color-green-700)" }}
            >
              1
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--color-green-900)" }}>You</p>
            <span className="ml-auto text-xs" style={{ color: "rgba(0,38,105,0.35)" }}>Primary</span>
          </div>

          {/* Additional players */}
          {fields.map((field, i) => {
            const isCollapsed = collapsed[i] ?? false;
            const fieldErrors = errors.players?.[i];
            const p = watchedPlayers[i];
            const filled = p?.mobile && p?.email && !fieldErrors;
            return (
              <div key={field.id} className="card mb-2 overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                    onClick={() => toggleCollapsed(i)}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: "rgba(0,38,105,0.06)", color: "var(--color-green-900)" }}
                    >
                      {i + 2}
                    </div>
                    <span className="text-sm font-medium flex-1 truncate" style={{ color: "var(--color-green-900)" }}>
                      {playerLabel(i)}
                    </span>
                    {isCollapsed && filled && (
                      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 16 16" fill="none"
                        style={{ color: "var(--color-green-700)" }}>
                        <path d="M2.5 8.5l3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    <svg
                      className={cn("w-4 h-4 flex-shrink-0 transition-transform duration-200", isCollapsed ? "" : "rotate-180")}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      style={{ color: "rgba(0,38,105,0.35)" }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => removePlayer(i)}
                    className="text-xs px-2 py-1 rounded-lg transition-colors flex-shrink-0"
                    style={{ color: "rgba(220,38,38,0.65)", background: "rgba(220,38,38,0.06)" }}
                  >
                    Remove
                  </button>
                </div>

                {/* Collapsible form */}
                {!isCollapsed && (
                  <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "rgba(0,38,105,0.07)" }}>
                    <div className="grid grid-cols-2 gap-2 pt-3">
                      <input
                        placeholder="First name"
                        className={inputBase}
                        style={inputStyle}
                        {...register(`players.${i}.firstName`)}
                      />
                      <input
                        placeholder="Last name"
                        className={inputBase}
                        style={inputStyle}
                        {...register(`players.${i}.lastName`)}
                      />
                    </div>

                    <div>
                      <input
                        placeholder="Mobile *"
                        type="tel"
                        className={cn(inputBase, fieldErrors?.mobile ? "border-red-300" : "")}
                        style={fieldErrors?.mobile ? errStyle : inputStyle}
                        {...register(`players.${i}.mobile`, {
                          required: "Mobile is required",
                          validate: (v) =>
                            PHONE_RE.test(v.trim()) || "Enter a valid mobile number",
                        })}
                      />
                      {fieldErrors?.mobile && (
                        <p className="text-xs mt-1" style={{ color: "rgba(220,38,38,0.8)" }}>
                          {fieldErrors.mobile.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <input
                        placeholder="Email *"
                        type="email"
                        className={cn(inputBase, fieldErrors?.email ? "border-red-300" : "")}
                        style={fieldErrors?.email ? errStyle : inputStyle}
                        {...register(`players.${i}.email`, {
                          required: "Email is required",
                          pattern: {
                            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                            message: "Enter a valid email address",
                          },
                        })}
                      />
                      {fieldErrors?.email && (
                        <p className="text-xs mt-1" style={{ color: "rgba(220,38,38,0.8)" }}>
                          {fieldErrors.email.message}
                        </p>
                      )}
                    </div>
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
              style={{ borderColor: "rgba(0,38,105,0.12)", color: "rgba(0,38,105,0.4)" }}
            >
              + Add another player
            </button>
          )}

          {maxAdditional === 0 && (
            <p className="text-xs text-center mt-1" style={{ color: "rgba(0,38,105,0.35)" }}>
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
                style={{ background: "rgba(133,187,101,0.12)", color: "var(--color-green-700)" }}
              >
                {i + 1}
              </span>
              <span className="text-sm" style={{ color: "rgba(0,38,105,0.5)" }}>{s}</span>
            </div>
          ))}
        </div>

        {error && (
          <div
            className="rounded-2xl border px-5 py-4"
            style={{ background: "rgba(239,68,68,0.05)", borderColor: "rgba(239,68,68,0.15)" }}
          >
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !isValid}
          className="btn btn-gold btn-full disabled:opacity-50"
        >
          {submitting ? (
            <><Spinner className="w-4 h-4 text-green-900" /> Submitting…</>
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

// ---- Success screen -----------------------------------------

function SuccessScreen({
  booking,
  onDone,
}: {
  booking: { date: string; time: string; players: number };
  onDone: () => void;
}) {
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
        Park Hyatt Aviara
      </p>
      {booking.players > 1 && (
        <p className="text-sm mb-8" style={{ color: "rgba(0,38,105,0.45)" }}>
          {booking.players} players
        </p>
      )}
      {booking.players <= 1 && <div className="mb-8" />}
      <div className="card p-5 w-full max-w-sm mb-8 text-left space-y-2">
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
      </div>
      <button onClick={onDone} className="btn btn-primary">
        Back to booking
      </button>
    </div>
  );
}

// ---- My bookings tab ----------------------------------------

const STATUS_LABELS: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  tentative: {
    label: "Pending confirmation",
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

function canCancel(booking: Booking): boolean {
  const hoursUntil = differenceInHours(
    new Date(`${booking.booking_date}T${booking.tee_time}`),
    new Date(),
  );
  return (
    hoursUntil > 0 &&
    !["cancelled", "payment_confirmed", "confirmed"].includes(booking.status)
  );
}

const CANCEL_REASONS = [
  "Change of plans",
  "Schedule conflict",
  "Weather concerns",
  "Booked a different date",
  "Other",
]

function CancelModal({
  open,
  onConfirm,
  onDismiss,
  submitting,
}: {
  open: boolean
  onConfirm: (reason: string) => void
  onDismiss: () => void
  submitting: boolean
}) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [selected, setSelected] = useState("")
  const [other, setOther] = useState("")

  useEffect(() => {
    if (open) {
      setMounted(true)
      const ids: number[] = []
      ids[0] = requestAnimationFrame(() => {
        ids[1] = requestAnimationFrame(() => setVisible(true))
      })
      return () => ids.forEach(id => cancelAnimationFrame(id))
    } else {
      setVisible(false)
      setSelected("")
      setOther("")
      const t = setTimeout(() => setMounted(false), 320)
      return () => clearTimeout(t)
    }
  }, [open])

  const reason = selected === "Other" ? other.trim() : selected
  const canSubmit = !!reason && !submitting

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop — dismiss on tap */}
      <button
        type="button"
        aria-label="Close"
        className={['absolute inset-0 w-full h-full', visible ? 'opacity-100' : 'opacity-0'].join(' ')}
        style={{ background: "rgba(0,0,0,0.45)", transition: 'opacity 200ms ease-out', willChange: 'opacity' }}
        onClick={onDismiss}
      />
      <div
        className={['relative bg-white rounded-t-3xl px-5 pt-5 pb-8 space-y-4', visible ? 'translate-y-0' : 'translate-y-full'].join(' ')}
        style={{
          boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
          transition: visible
            ? 'transform 340ms cubic-bezier(0.32,0.72,0,1)'
            : 'transform 240ms cubic-bezier(0.4,0,1,1)',
          willChange: 'transform',
        }}>
        <div className="flex items-center justify-between mb-1">
          <p className="font-sans font-black text-lg" style={{ color: "var(--color-green-900)" }}>
            Cancel booking
          </p>
          <button onClick={onDismiss} className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,38,105,0.06)", color: "rgba(0,38,105,0.5)" }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm" style={{ color: "rgba(0,38,105,0.55)" }}>
          Please let us know why you&apos;re cancelling.
        </p>

        <div className="space-y-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setSelected(r)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-colors"
              style={
                selected === r
                  ? { borderColor: "var(--color-green-900)", background: "rgba(0,38,105,0.04)" }
                  : { borderColor: "rgba(0,38,105,0.1)" }
              }
            >
              <span
                className="w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                style={{ borderColor: selected === r ? "var(--color-green-900)" : "rgba(0,38,105,0.25)" }}
              >
                {selected === r && (
                  <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-green-900)" }} />
                )}
              </span>
              <span className="text-sm" style={{ color: "var(--color-green-900)" }}>{r}</span>
            </button>
          ))}
        </div>

        {selected === "Other" && (
          <textarea
            rows={2}
            placeholder="Tell us more…"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-xl border outline-none resize-none transition-colors focus:border-green-700"
            style={{ borderColor: "rgba(0,38,105,0.12)", color: "var(--color-green-900)" }}
          />
        )}

        <button
          onClick={() => canSubmit && onConfirm(reason)}
          disabled={!canSubmit}
          className="btn btn-full text-sm font-semibold disabled:opacity-40 rounded-2xl py-3.5"
          style={{
            background: canSubmit ? "rgba(220,38,38,0.9)" : "rgba(220,38,38,0.4)",
            color: "white",
          }}
        >
          {submitting ? <Spinner className="w-4 h-4 text-white mx-auto" /> : "Confirm cancellation"}
        </button>
      </div>
    </div>
  )
}

type BookingGroup = {
  primary: Booking
  players: Booking[]
}

function groupBookings(bookings: Booking[]): BookingGroup[] {
  const bySlot = new Map<string, Booking[]>()
  for (const b of bookings) {
    const key = `${b.booking_date}_${b.tee_time}`
    const slot = bySlot.get(key) ?? []
    slot.push(b)
    bySlot.set(key, slot)
  }
  const groups: BookingGroup[] = []
  for (const slot of bySlot.values()) {
    const primary = slot.find((b) => b.guest_name === null) ?? slot[0]
    if (!primary) continue
    groups.push({ primary, players: slot.filter((b) => b.id !== primary.id) })
  }
  return groups
}

function MyBookingsTab({
  bookings,
  onRefresh,
}: {
  bookings: Booking[];
  onRefresh: () => void;
}) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelGroup, setCancelGroup] = useState<BookingGroup | null>(null);

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const allGroups = groupBookings(bookings);
  const upcoming = allGroups.filter(
    (g) => g.primary.booking_date >= todayStr && g.primary.status !== "cancelled",
  );
  const past = allGroups.filter((g) => g.primary.booking_date < todayStr);

  async function confirmCancel(reason: string) {
    if (!cancelGroup) return
    const ids = [cancelGroup.primary.id, ...cancelGroup.players.map((p) => p.id)]
    setCancelling(cancelGroup.primary.id)
    setCancelGroup(null)
    await Promise.all(ids.map((id) => apiClient.patch(`/api/bookings/${id}`, { cancellationReason: reason })))
    onRefresh()
    setCancelling(null)
  }

  return (
    <div className="px-5 py-5 pb-8">
      <CancelModal
        open={!!cancelGroup}
        onConfirm={confirmCancel}
        onDismiss={() => setCancelGroup(null)}
        submitting={!!cancelling}
      />

      {upcoming.length === 0 && past.length === 0 && (
        <EmptyState
          icon="🗓️"
          title="No bookings yet"
          description="Book your first round using the calendar above."
        />
      )}

      {upcoming.length > 0 && (
        <>
          <p className="section-label mb-3">Upcoming</p>
          <div className="space-y-2.5 mb-7">
            {upcoming.map((group) => {
              const totalAmount =
                group.primary.amount_charged +
                group.players.reduce((sum, p) => sum + p.amount_charged, 0);
              const totalPlayers = 1 + group.players.length;

              return (
                <div key={group.primary.id} className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium"
                        style={{ color: "var(--color-green-900)" }}
                      >
                        {format(
                          new Date(group.primary.booking_date + "T12:00:00"),
                          "EEE, MMM d",
                        )}
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: "rgba(0,38,105,0.45)" }}
                      >
                        {formatTeeTime(group.primary.tee_time)} · $
                        {totalAmount.toFixed(0)}
                        {totalPlayers > 1 && ` · ${totalPlayers} players`}
                      </p>

                      {group.players.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {group.players.map((p) => (
                            <span
                              key={p.id}
                              className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                              style={{
                                background: "rgba(0,38,105,0.06)",
                                color: "rgba(0,38,105,0.6)",
                              }}
                            >
                              {p.guest_name}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-2">
                        <BookingStatusBadge status={group.primary.status} />
                      </div>
                    </div>
                    {canCancel(group.primary) && (
                      <button
                        onClick={() => setCancelGroup(group)}
                        disabled={cancelling === group.primary.id}
                        className="text-xs flex-shrink-0 py-1 px-2.5 rounded-lg border transition-colors mt-0.5"
                        style={{
                          color: "rgba(220,38,38,0.7)",
                          borderColor: "rgba(220,38,38,0.15)",
                          background: "rgba(220,38,38,0.04)",
                        }}
                      >
                        {cancelling === group.primary.id ? (
                          <Spinner className="w-3 h-3 text-red-400" />
                        ) : (
                          "Cancel"
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <p className="section-label mb-3">Past rounds</p>
          <div className="space-y-2">
            {past.slice(0, 10).map((group) => (
              <div key={group.primary.id} className="card p-4" style={{ opacity: 0.55 }}>
                <p
                  className="text-sm"
                  style={{ color: "var(--color-green-900)" }}
                >
                  {format(
                    new Date(group.primary.booking_date + "T12:00:00"),
                    "EEE, MMM d, yyyy",
                  )}
                </p>
                <p
                  className="text-xs mt-0.5"
                  style={{ color: "rgba(0,38,105,0.5)" }}
                >
                  {formatTeeTime(group.primary.tee_time)}
                  {group.players.length > 0 &&
                    ` · ${1 + group.players.length} players`}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Shared -----------------------------------------------
