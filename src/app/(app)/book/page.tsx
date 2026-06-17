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
import { useSearchParams } from "next/navigation";
import { formatTeeTime, cn, bookingToLocalDate } from "@/lib/utils";
import Select from "@/components/ui/Select";
import {
  format,
  parse,
  addDays,
  addMinutes,
  addMonths,
  differenceInHours,
  getDaysInMonth,
  startOfMonth,
} from "date-fns";
import type {
  Booking,
  GHLBookingSlot,
  AdditionalPlayer,
  MemberWithProfile,
} from "@/types";
import {
  BOOKING_PRICE_USD,
  POLICY_TIERS,
  GOLF_ROUND_DURATION_MINUTES,
  AVIARA_TIMEZONE,
  BOOKING_PAYMENT_URL,
  GHL_CANCEL_BOOKING_URL,
} from "@/lib/constants";
import { validateEmail } from "@/lib/validation";

type PlayerKind = "member" | "non_member";

// A phone number is required for non-member invites; keep the check lenient
// (digits/format vary) but reject obviously-too-short values.
function isValidGuestPhone(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length >= 7;
}

type Step = "select" | "confirm" | "success";

interface DayPlayer {
  member_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  booking_date: string;
  tee_time: string;
  players: number;
  is_self: boolean;
}

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

function slotEndTime(startIso: string): string {
  const timeStr = startIso.split("T")[1]?.slice(0, 8) ?? "00:00:00";
  return format(
    addMinutes(
      parse(timeStr, "HH:mm:ss", new Date()),
      GOLF_ROUND_DURATION_MINUTES,
    ),
    "h:mm a",
  );
}

export default function BookPage() {
  const { user } = useProfile();
  const searchParams = useSearchParams();
  const inviteMemberId = searchParams?.get("invite") ?? null;

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
    pendingNonMembers: number;
  } | null>(null);

  // My bookings tab
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [activeTab, setActiveTab] = useState<"book" | "myBookings">("book");
  const [viewMode, setViewMode] = useState<"day" | "month">("day");

  // Who's playing on the selected date
  const [dayPlayers, setDayPlayers] = useState<DayPlayer[]>([]);
  const [loadingDayPlayers, setLoadingDayPlayers] = useState(false);

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
  useEffect(() => {
    if (!selectedDate || !user) {
      setDayPlayers([]);
      return;
    }
    setLoadingDayPlayers(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch(`/api/bookings/day?date=${selectedDate}&timezone=${encodeURIComponent(tz)}`)
      .then((r) => r.json())
      .then((d) => setDayPlayers(Array.isArray(d.players) ? d.players : []))
      .catch(() => setDayPlayers([]))
      .finally(() => setLoadingDayPlayers(false));
  }, [selectedDate, user]);

  // These must stay above the early returns to satisfy the rules of hooks
  const todayStr = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: AVIARA_TIMEZONE,
    }).formatToParts(today);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }, [today]);
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
    target?.scrollIntoView({
      behavior: "instant",
      block: "nearest",
      inline: "start",
    });
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

    const res = await fetch("/api/bookings/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startTime: selectedSlot.startTime,
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
        pendingNonMembers:
          typeof data.pendingNonMembers === "number"
            ? data.pendingNonMembers
            : additionalPlayers.filter((p) => p.isNonMember).length,
      });
      if (Array.isArray(data.bookings)) {
        setMyBookings((prev) => [...(data.bookings as Booking[]), ...prev]);
      }
      setStep("success");
      fetchMonthSlots();
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
        inviteMemberId={inviteMemberId}
        bookerEmail={user?.email ?? ""}
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
        <div className="pb-8 md:max-w-2xl md:mx-auto">
          {/* Timezone selector + view toggle */}
          <div className="px-5 md:px-8 pt-4 pb-1 flex items-center gap-2">
            <span
              className="text-xs flex-shrink-0"
              style={{ color: "rgba(0,38,105,0.4)" }}
            >
              Timezone
            </span>
            <Select
              options={timezones.map((tz) => ({
                value: tz,
                label: tz.replace(/_/g, " "),
              }))}
              value={timezone}
              onChange={setTimezone}
              className="flex-1 min-w-0"
              triggerClassName="w-full flex items-center justify-between gap-1.5 text-xs py-1.5 px-2.5 rounded-xl border border-green-900/10 bg-white text-green-900 focus:outline-none focus:ring-2 focus:ring-green-900/20 truncate"
              searchPlaceholder="Search timezone…"
            />
            <div
              className="flex p-0.5 rounded-lg flex-shrink-0"
              style={{ background: "rgba(0,38,105,0.06)" }}
            >
              {(["day", "month"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md capitalize transition-all"
                  style={
                    viewMode === mode
                      ? {
                          background: "white",
                          color: "var(--color-green-900)",
                          boxShadow: "0 1px 2px rgba(0,38,105,0.1)",
                        }
                      : { color: "rgba(0,38,105,0.45)" }
                  }
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Month navigation */}
          <div className="px-5 md:px-8 pt-3 pb-2 flex items-center justify-between">
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

          {/* Date picker — day strip or month grid */}
          <div className="px-5 md:px-8 pb-3">
            {viewMode === "day" ? (
              loadingMonth ? (
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
              )
            ) : (
              <MonthCalendarGrid
                year={year}
                month={month}
                daysInMonth={daysInMonth}
                selectedDate={selectedDate}
                todayStr={todayStr}
                firstInWindowDateStr={firstInWindowDateStr}
                hasDaySlots={hasDaySlots}
                getDateStr={getDateStr}
                loadingMonth={loadingMonth}
                onSelectDate={(dateStr) => {
                  setSelectedDate(dateStr);
                  setSelectedSlot(null);
                }}
                selectedDateRef={selectedDateRef}
                firstInWindowRef={firstInWindowRef}
              />
            )}
          </div>

          {/* Who's playing on selected date */}
          {selectedDate &&
            !loadingMonth &&
            (dayPlayers.length > 0 || loadingDayPlayers) && (
              <div className="px-5 md:px-8 pb-1">
                <p className="section-label mb-2">
                  {loadingDayPlayers
                    ? "Who's playing…"
                    : `Who's playing · ${dayPlayers.length}`}
                </p>
                {loadingDayPlayers ? (
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div
                        key={i}
                        className="flex flex-col items-center gap-1.5 animate-pulse flex-1 min-w-0"
                      >
                        <div
                          className="w-10 h-10 rounded-full mx-auto"
                          style={{ background: "rgba(0,38,105,0.08)" }}
                        />
                        <div
                          className="w-8 h-2 rounded-full mx-auto"
                          style={{ background: "rgba(0,38,105,0.08)" }}
                        />
                        <div
                          className="w-6 h-1.5 rounded-full mx-auto"
                          style={{ background: "rgba(0,38,105,0.05)" }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
                    {dayPlayers.map((p) => (
                      <DayPlayerBubble key={p.member_id} player={p} />
                    ))}
                  </div>
                )}
              </div>
            )}

          {/* Tee time slots for selected date */}
          {selectedDate && !loadingMonth && (
            <div className="px-5 md:px-8 pt-5">
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
            className="text-xs text-center mt-6 px-5 md:px-8 leading-relaxed"
            style={{ color: "rgba(0,38,105,0.25)" }}
          >
            Select a date and tee time to submit a booking request.
            <br />
            Availability is confirmed by the team — payment link sent by email.
          </p>
        </div>
      ) : (
        <MyBookingsTab
          bookings={myBookings}
          onRefresh={loadMyBookings}
          onSwitchToBook={() => setActiveTab("book")}
        />
      )}
    </AppShell>
  );
}

// ---- Month calendar grid ------------------------------------

function MonthCalendarGrid({
  year,
  month,
  daysInMonth,
  selectedDate,
  todayStr,
  firstInWindowDateStr,
  hasDaySlots,
  getDateStr,
  loadingMonth,
  onSelectDate,
  selectedDateRef,
  firstInWindowRef,
}: {
  year: number;
  month: number;
  daysInMonth: number;
  selectedDate: string;
  todayStr: string;
  firstInWindowDateStr: string | null;
  hasDaySlots: (day: number) => boolean;
  getDateStr: (day: number) => string;
  loadingMonth: boolean;
  onSelectDate: (dateStr: string) => void;
  selectedDateRef: React.RefObject<HTMLButtonElement>;
  firstInWindowRef: React.RefObject<HTMLButtonElement>;
}) {
  if (loadingMonth) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="text-green-700" />
      </div>
    );
  }

  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const startDow = new Date(year, month, 1).getDay();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
  const cells: (number | null)[] = Array.from({ length: totalCells }, (_, i) => {
    const d = i - startDow + 1;
    return d >= 1 && d <= daysInMonth ? d : null;
  });

  return (
    <div>
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-1">
        {DOW.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-medium py-1.5"
            style={{ color: "rgba(0,38,105,0.35)" }}
          >
            {d}
          </div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} />;
          const dateStr = getDateStr(day);
          const isPast = dateStr < todayStr;
          const isToday = dateStr === todayStr;
          const hasSlots = hasDaySlots(day);
          const canClick = isToday || (!isPast && hasSlots);
          const active = selectedDate === dateStr;

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
              onClick={canClick ? () => onSelectDate(dateStr) : undefined}
              disabled={!canClick}
              className={cn(
                "relative flex flex-col items-center justify-center py-2 rounded-xl transition-all duration-150",
                isPast ? "opacity-40" : !hasSlots && !isToday ? "opacity-50" : "",
                !canClick ? "cursor-not-allowed" : active ? "" : "hover:bg-green-50/60",
              )}
              style={active ? { background: "var(--color-green-900)" } : {}}
            >
              <span
                className={cn(
                  "font-sans font-black text-sm leading-none",
                  isToday && !active ? "underline underline-offset-2" : "",
                )}
                style={{ color: active ? "white" : "var(--color-green-900)" }}
              >
                {day}
              </span>
              {hasSlots && (
                <span
                  className="mt-1 w-1 h-1 rounded-full"
                  style={{
                    background: active
                      ? "rgba(133,187,101,0.8)"
                      : "var(--color-green-600, #16a34a)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Day player bubble + popover ----------------------------

interface MemberDetail {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  profile: {
    display_name: string;
    avatar_url: string | null;
    business_name: string | null;
    role_title: string | null;
    handicap_index: number | null;
    show_handicap: boolean;
    industry_category: string | null;
    value_offered: string | null;
    preferred_play_times: string | null;
    play_frequency: string | null;
    open_to_golf_travel: boolean;
    non_golf_hobbies: string | null;
  } | null;
}

function DayPlayerBubble({ player }: { player: DayPlayer }) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [hasPlayedWith, setHasPlayedWith] = useState(false);
  const [focusGroups, setFocusGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  function openPopover() {
    setMounted(true);
    if (!detail) {
      setLoading(true);
      fetch(`/api/members/${player.member_id}`)
        .then((r) => r.json())
        .then((d) => {
          setDetail(d.member ?? null);
          setHasPlayedWith(!!d.hasPlayedWith);
          setFocusGroups(
            Array.isArray(d.focusLinkupGroups) ? d.focusLinkupGroups : [],
          );
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }

  function closePopover() {
    setVisible(false);
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }

  useEffect(() => {
    if (!mounted) return;
    const ids: number[] = [];
    ids[0] = requestAnimationFrame(() => {
      ids[1] = requestAnimationFrame(() => setVisible(true));
    });
    return () => ids.forEach((id) => cancelAnimationFrame(id));
  }, [mounted]);

  const prof = detail?.profile;
  const displayName = player.is_self
    ? 'You'
    : prof?.display_name || `${player.first_name} ${player.last_name}`.trim();
  const initials =
    `${player.first_name[0] ?? ""}${player.last_name[0] ?? ""}`.toUpperCase();
  const avatarUrl = prof?.avatar_url ?? player.avatar_url;
  const localDate = bookingToLocalDate(player.booking_date, player.tee_time);
  const localTeeTime = `${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}:00`;

  return (
    <>
      <button
        type="button"
        onClick={player.is_self ? undefined : openPopover}
        className="flex flex-col items-center gap-1 flex-shrink-0 w-14 transition-opacity active:opacity-60"
        style={{ cursor: player.is_self ? 'default' : undefined }}
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt=""
            width={40}
            height={40}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
            style={{
              background: "rgba(133,187,101,0.15)",
              color: "var(--color-green-700)",
            }}
          >
            {initials}
          </div>
        )}
        <span
          className="text-[10px] font-medium text-center leading-tight truncate w-full"
          style={{ color: "var(--color-green-900)" }}
        >
          {player.first_name}
        </span>
        <span
          className="text-[9px] text-center"
          style={{ color: "rgba(0,38,105,0.38)" }}
        >
          {formatTeeTime(localTeeTime)}
        </span>
      </button>

      {mounted && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-6">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 w-full h-full"
            style={{
              background: "rgba(0,0,0,0.45)",
              opacity: visible ? 1 : 0,
              transition: "opacity 200ms ease-out",
            }}
            onClick={closePopover}
          />
          <div
            className="relative bg-white rounded-t-3xl md:rounded-3xl pt-5 pb-8 w-full md:max-w-md"
            style={{
              boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
              transform: visible ? "translateY(0)" : "translateY(100%)",
              transition: visible
                ? "transform 340ms cubic-bezier(0.32,0.72,0,1)"
                : "transform 240ms cubic-bezier(0.4,0,1,1)",
              willChange: "transform",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center mb-4 flex-shrink-0">
              <div
                className="w-10 h-1 rounded-full"
                style={{ background: "rgba(0,38,105,0.12)" }}
              />
            </div>

            {loading ? (
              <div className="flex flex-col items-center py-10 gap-3 px-5">
                <div
                  className="w-16 h-16 rounded-2xl animate-pulse"
                  style={{ background: "rgba(0,38,105,0.08)" }}
                />
                <div
                  className="w-36 h-3.5 rounded-full animate-pulse"
                  style={{ background: "rgba(0,38,105,0.08)" }}
                />
                <div
                  className="w-24 h-2.5 rounded-full animate-pulse"
                  style={{ background: "rgba(0,38,105,0.06)" }}
                />
                <div
                  className="w-full h-16 rounded-2xl animate-pulse mt-2"
                  style={{ background: "rgba(0,38,105,0.05)" }}
                />
              </div>
            ) : (
              <div className="overflow-y-auto flex-1 px-5 space-y-4">
                {/* Header */}
                <div className="flex items-start gap-4">
                  {avatarUrl ? (
                    <Image
                      src={avatarUrl}
                      alt=""
                      width={60}
                      height={60}
                      className="w-15 h-15 rounded-2xl object-cover flex-shrink-0"
                      style={{ width: 60, height: 60 }}
                    />
                  ) : (
                    <div
                      className="rounded-2xl flex items-center justify-center text-xl font-bold flex-shrink-0"
                      style={{
                        width: 60,
                        height: 60,
                        background: "rgba(133,187,101,0.15)",
                        color: "var(--color-green-700)",
                      }}
                    >
                      {initials}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p
                        className="font-sans font-black text-lg leading-tight"
                        style={{ color: "var(--color-green-900)" }}
                      >
                        {displayName}
                      </p>
                      {hasPlayedWith && (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{
                            background: "rgba(133,187,101,0.15)",
                            color: "var(--color-green-700)",
                          }}
                        >
                          Played before
                        </span>
                      )}
                    </div>
                    {prof?.role_title && (
                      <p
                        className="text-sm mt-0.5"
                        style={{ color: "rgba(0,38,105,0.55)" }}
                      >
                        {prof.role_title}
                      </p>
                    )}
                    {prof?.business_name && (
                      <p
                        className="text-xs mt-0.5 truncate"
                        style={{ color: "rgba(0,38,105,0.4)" }}
                      >
                        {prof.business_name}
                      </p>
                    )}
                  </div>
                </div>

                {/* Stats strip */}
                <div
                  className="flex rounded-2xl overflow-hidden"
                  style={{ background: "rgba(0,38,105,0.04)" }}
                >
                  <div className="flex-1 py-3 text-center">
                    <p
                      className="text-[9px] uppercase tracking-wider mb-0.5"
                      style={{ color: "rgba(0,38,105,0.38)" }}
                    >
                      Tee time
                    </p>
                    <p
                      className="font-sans font-black text-sm"
                      style={{ color: "var(--color-green-900)" }}
                    >
                      {formatTeeTime(localTeeTime)}
                    </p>
                  </div>
                  {player.players > 1 && (
                    <>
                      <div
                        className="w-px my-2.5"
                        style={{ background: "rgba(0,38,105,0.08)" }}
                      />
                      <div className="flex-1 py-3 text-center">
                        <p
                          className="text-[9px] uppercase tracking-wider mb-0.5"
                          style={{ color: "rgba(0,38,105,0.38)" }}
                        >
                          Group
                        </p>
                        <p
                          className="font-sans font-black text-sm"
                          style={{ color: "var(--color-green-900)" }}
                        >
                          {player.players} players
                        </p>
                      </div>
                    </>
                  )}
                  {prof?.show_handicap && prof?.handicap_index != null && (
                    <>
                      <div
                        className="w-px my-2.5"
                        style={{ background: "rgba(0,38,105,0.08)" }}
                      />
                      <div className="flex-1 py-3 text-center">
                        <p
                          className="text-[9px] uppercase tracking-wider mb-0.5"
                          style={{ color: "rgba(0,38,105,0.38)" }}
                        >
                          HCP
                        </p>
                        <p
                          className="font-sans font-black text-sm"
                          style={{ color: "var(--color-green-900)" }}
                        >
                          {prof.handicap_index}
                        </p>
                      </div>
                    </>
                  )}
                  {prof?.open_to_golf_travel && (
                    <>
                      <div
                        className="w-px my-2.5"
                        style={{ background: "rgba(0,38,105,0.08)" }}
                      />
                      <div className="flex-1 py-3 text-center">
                        <p
                          className="text-[9px] uppercase tracking-wider mb-0.5"
                          style={{ color: "rgba(0,38,105,0.38)" }}
                        >
                          Golf travel
                        </p>
                        <p
                          className="text-sm"
                          style={{ color: "var(--color-green-700)" }}
                        >
                          ✓ Open
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* Value offered */}
                {prof?.value_offered && (
                  <div
                    className="rounded-2xl px-4 py-3.5"
                    style={{
                      background: "rgba(0,38,105,0.03)",
                      border: "1px solid rgba(0,38,105,0.06)",
                    }}
                  >
                    <p
                      className="text-[10px] uppercase tracking-wider mb-1.5"
                      style={{ color: "rgba(0,38,105,0.38)" }}
                    >
                      What they bring
                    </p>
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: "rgba(0,38,105,0.7)" }}
                    >
                      {prof.value_offered}
                    </p>
                  </div>
                )}

                {/* Play preferences */}
                {(prof?.play_frequency || prof?.preferred_play_times) && (
                  <div
                    className="rounded-2xl px-4 py-3.5"
                    style={{
                      background: "rgba(0,38,105,0.03)",
                      border: "1px solid rgba(0,38,105,0.06)",
                    }}
                  >
                    <p
                      className="text-[10px] uppercase tracking-wider mb-2"
                      style={{ color: "rgba(0,38,105,0.38)" }}
                    >
                      Play habits
                    </p>
                    <div className="space-y-1.5">
                      {prof?.play_frequency && (
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs"
                            style={{ color: "rgba(0,38,105,0.4)" }}
                          >
                            Frequency
                          </span>
                          <span
                            className="text-xs font-medium"
                            style={{ color: "var(--color-green-900)" }}
                          >
                            {prof.play_frequency}
                          </span>
                        </div>
                      )}
                      {prof?.preferred_play_times && (
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs"
                            style={{ color: "rgba(0,38,105,0.4)" }}
                          >
                            Prefers
                          </span>
                          <span
                            className="text-xs font-medium"
                            style={{ color: "var(--color-green-900)" }}
                          >
                            {prof.preferred_play_times}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Focus linkup groups */}
                {focusGroups.length > 0 && (
                  <div>
                    <p
                      className="text-[10px] uppercase tracking-wider mb-2"
                      style={{ color: "rgba(0,38,105,0.38)" }}
                    >
                      Focus groups
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {focusGroups.map((g) => (
                        <span
                          key={g}
                          className="text-xs font-medium px-2.5 py-1 rounded-full"
                          style={{
                            background: "rgba(0,38,105,0.06)",
                            color: "var(--color-green-900)",
                          }}
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Non-golf hobbies */}
                {prof?.non_golf_hobbies && (
                  <div
                    className="rounded-2xl px-4 py-3.5"
                    style={{
                      background: "rgba(0,38,105,0.03)",
                      border: "1px solid rgba(0,38,105,0.06)",
                    }}
                  >
                    <p
                      className="text-[10px] uppercase tracking-wider mb-1.5"
                      style={{ color: "rgba(0,38,105,0.38)" }}
                    >
                      Beyond the course
                    </p>
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: "rgba(0,38,105,0.7)" }}
                    >
                      {prof.non_golf_hobbies}
                    </p>
                  </div>
                )}

                {/* CTA */}
                <a
                  href={`/members/${player.member_id}`}
                  className="btn btn-primary btn-full text-center block"
                >
                  View profile
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---- Reusable member profile sheet --------------------------

function MemberProfileSheet({
  memberId,
  onClose,
}: {
  memberId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [hasPlayedWith, setHasPlayedWith] = useState(false);
  const [focusGroups, setFocusGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (memberId) {
      setDetail(null);
      setHasPlayedWith(false);
      setFocusGroups([]);
      setMounted(true);
      setLoading(true);
      fetch(`/api/members/${memberId}`)
        .then((r) => r.json())
        .then((d) => {
          setDetail(d.member ?? null);
          setHasPlayedWith(!!d.hasPlayedWith);
          setFocusGroups(
            Array.isArray(d.focusLinkupGroups) ? d.focusLinkupGroups : [],
          );
        })
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }
    setVisible(false);
    const t = setTimeout(() => {
      setMounted(false);
      setDetail(null);
    }, 320);
    return () => clearTimeout(t);
  }, [memberId]);

  useEffect(() => {
    if (!mounted) return;
    const ids: number[] = [];
    ids[0] = requestAnimationFrame(() => {
      ids[1] = requestAnimationFrame(() => setVisible(true));
    });
    return () => ids.forEach((id) => cancelAnimationFrame(id));
  }, [mounted]);

  if (!mounted) return null;

  const prof = detail?.profile;
  const displayName =
    prof?.display_name ||
    (detail ? `${detail.first_name} ${detail.last_name}`.trim() : "");
  const initials = detail
    ? `${detail.first_name[0] ?? ""}${detail.last_name[0] ?? ""}`.toUpperCase()
    : "?";
  const avatarUrl = prof?.avatar_url ?? null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 w-full h-full"
        style={{
          background: "rgba(0,0,0,0.45)",
          opacity: visible ? 1 : 0,
          transition: "opacity 200ms ease-out",
        }}
        onClick={onClose}
      />
      <div
        className="relative bg-white rounded-t-3xl md:rounded-3xl pt-5 pb-8 w-full md:max-w-md"
        style={{
          boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: visible
            ? "transform 340ms cubic-bezier(0.32,0.72,0,1)"
            : "transform 240ms cubic-bezier(0.4,0,1,1)",
          willChange: "transform",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="flex justify-center mb-4 flex-shrink-0">
          <div
            className="w-10 h-1 rounded-full"
            style={{ background: "rgba(0,38,105,0.12)" }}
          />
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-10 gap-3 px-5">
            <div
              className="w-16 h-16 rounded-2xl animate-pulse"
              style={{ background: "rgba(0,38,105,0.08)" }}
            />
            <div
              className="w-36 h-3.5 rounded-full animate-pulse"
              style={{ background: "rgba(0,38,105,0.08)" }}
            />
            <div
              className="w-24 h-2.5 rounded-full animate-pulse"
              style={{ background: "rgba(0,38,105,0.06)" }}
            />
            <div
              className="w-full h-16 rounded-2xl animate-pulse mt-2"
              style={{ background: "rgba(0,38,105,0.05)" }}
            />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 px-5 space-y-4">
            {/* Header */}
            <div className="flex items-start gap-4">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  width={60}
                  height={60}
                  className="rounded-2xl object-cover flex-shrink-0"
                  style={{ width: 60, height: 60 }}
                />
              ) : (
                <div
                  className="rounded-2xl flex items-center justify-center text-xl font-bold flex-shrink-0"
                  style={{
                    width: 60,
                    height: 60,
                    background: "rgba(133,187,101,0.15)",
                    color: "var(--color-green-700)",
                  }}
                >
                  {initials}
                </div>
              )}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p
                    className="font-sans font-black text-lg leading-tight"
                    style={{ color: "var(--color-green-900)" }}
                  >
                    {displayName}
                  </p>
                  {hasPlayedWith && (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{
                        background: "rgba(133,187,101,0.15)",
                        color: "var(--color-green-700)",
                      }}
                    >
                      Played before
                    </span>
                  )}
                </div>
                {prof?.role_title && (
                  <p
                    className="text-sm mt-0.5"
                    style={{ color: "rgba(0,38,105,0.55)" }}
                  >
                    {prof.role_title}
                  </p>
                )}
                {prof?.business_name && (
                  <p
                    className="text-xs mt-0.5 truncate"
                    style={{ color: "rgba(0,38,105,0.4)" }}
                  >
                    {prof.business_name}
                  </p>
                )}
              </div>
            </div>

            {/* Stats strip */}
            {(prof?.show_handicap && prof?.handicap_index != null) ||
            prof?.open_to_golf_travel ? (
              <div
                className="flex rounded-2xl overflow-hidden"
                style={{ background: "rgba(0,38,105,0.04)" }}
              >
                {prof?.show_handicap && prof?.handicap_index != null && (
                  <div className="flex-1 py-3 text-center">
                    <p
                      className="text-[9px] uppercase tracking-wider mb-0.5"
                      style={{ color: "rgba(0,38,105,0.38)" }}
                    >
                      HCP
                    </p>
                    <p
                      className="font-sans font-black text-sm"
                      style={{ color: "var(--color-green-900)" }}
                    >
                      {prof.handicap_index}
                    </p>
                  </div>
                )}
                {prof?.open_to_golf_travel && (
                  <>
                    {prof?.show_handicap && prof?.handicap_index != null && (
                      <div
                        className="w-px my-2.5"
                        style={{ background: "rgba(0,38,105,0.08)" }}
                      />
                    )}
                    <div className="flex-1 py-3 text-center">
                      <p
                        className="text-[9px] uppercase tracking-wider mb-0.5"
                        style={{ color: "rgba(0,38,105,0.38)" }}
                      >
                        Golf travel
                      </p>
                      <p
                        className="text-sm"
                        style={{ color: "var(--color-green-700)" }}
                      >
                        ✓ Open
                      </p>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {prof?.value_offered && (
              <div
                className="rounded-2xl px-4 py-3.5"
                style={{
                  background: "rgba(0,38,105,0.03)",
                  border: "1px solid rgba(0,38,105,0.06)",
                }}
              >
                <p
                  className="text-[10px] uppercase tracking-wider mb-1.5"
                  style={{ color: "rgba(0,38,105,0.38)" }}
                >
                  What they bring
                </p>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "rgba(0,38,105,0.7)" }}
                >
                  {prof.value_offered}
                </p>
              </div>
            )}

            {(prof?.play_frequency || prof?.preferred_play_times) && (
              <div
                className="rounded-2xl px-4 py-3.5"
                style={{
                  background: "rgba(0,38,105,0.03)",
                  border: "1px solid rgba(0,38,105,0.06)",
                }}
              >
                <p
                  className="text-[10px] uppercase tracking-wider mb-2"
                  style={{ color: "rgba(0,38,105,0.38)" }}
                >
                  Play habits
                </p>
                <div className="space-y-1.5">
                  {prof?.play_frequency && (
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs"
                        style={{ color: "rgba(0,38,105,0.4)" }}
                      >
                        Frequency
                      </span>
                      <span
                        className="text-xs font-medium"
                        style={{ color: "var(--color-green-900)" }}
                      >
                        {prof.play_frequency}
                      </span>
                    </div>
                  )}
                  {prof?.preferred_play_times && (
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs"
                        style={{ color: "rgba(0,38,105,0.4)" }}
                      >
                        Prefers
                      </span>
                      <span
                        className="text-xs font-medium"
                        style={{ color: "var(--color-green-900)" }}
                      >
                        {prof.preferred_play_times}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {focusGroups.length > 0 && (
              <div>
                <p
                  className="text-[10px] uppercase tracking-wider mb-2"
                  style={{ color: "rgba(0,38,105,0.38)" }}
                >
                  Focus groups
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {focusGroups.map((g) => (
                    <span
                      key={g}
                      className="text-xs font-medium px-2.5 py-1 rounded-full"
                      style={{
                        background: "rgba(0,38,105,0.06)",
                        color: "var(--color-green-900)",
                      }}
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {prof?.non_golf_hobbies && (
              <div
                className="rounded-2xl px-4 py-3.5"
                style={{
                  background: "rgba(0,38,105,0.03)",
                  border: "1px solid rgba(0,38,105,0.06)",
                }}
              >
                <p
                  className="text-[10px] uppercase tracking-wider mb-1.5"
                  style={{ color: "rgba(0,38,105,0.38)" }}
                >
                  Beyond the course
                </p>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "rgba(0,38,105,0.7)" }}
                >
                  {prof.non_golf_hobbies}
                </p>
              </div>
            )}

            {memberId && (
              <a
                href={`/members/${memberId}`}
                className="btn btn-primary btn-full text-center block"
              >
                View profile
              </a>
            )}
          </div>
        )}
      </div>
    </div>
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
          Until ~{slotEndTime(slot.startTime)}
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
    if (!value || !validateEmail(value).valid) return "Enter a valid email address";
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
    setCollapsed((prev) => [...prev, true]);
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
      return validateGuestEmail(p?.email) === true && validateGuestPhone(p?.mobile) === true;
    }
    return !!playerSelections[i];
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
    if (member.phone) {
      setCollapsed((prev) => prev.map((c, idx) => (idx === i ? true : c)));
    }
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

              return (
                <div key={field.id} className="card mb-2">
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
                      {isCollapsed && selection && (
                        <svg
                          className="w-3.5 h-3.5 flex-shrink-0"
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
                                      ? { ...inputStyle, borderColor: "#dc2626" }
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
                                      ? { ...inputStyle, borderColor: "#dc2626" }
                                      : inputStyle
                                  }
                                />
                                {rowErrors?.email && (
                                  <p className="text-xs mt-1 text-red-600">
                                    {rowErrors.email.message}
                                  </p>
                                )}
                              </div>
                              {(rowErrors?.firstName || rowErrors?.lastName) && (
                                <p className="text-xs text-red-600">
                                  {(rowErrors.firstName || rowErrors.lastName)?.message}
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
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  function measureInput() {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropdownRect({ top: r.bottom + 4, left: r.left, width: r.width });
    }
  }

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
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

  const VISIBLE_ROWS = 4;
  const ROW_HEIGHT = 52; // px — matches py-2.5 + content height

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
      {open && filtered.length > 0 && dropdownRect && (
        <div
          ref={dropdownRef}
          className="bg-white rounded-xl border shadow-lg"
          style={{
            position: "fixed",
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
            zIndex: 9999,
            borderColor: "rgba(0,38,105,0.12)",
            maxHeight: VISIBLE_ROWS * ROW_HEIGHT,
            overflowY: filtered.length > VISIBLE_ROWS ? "auto" : "hidden",
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
        </div>
      )}
    </div>
  );
}

// ---- Success screen -----------------------------------------

function SuccessScreen({
  booking,
  onDone,
}: {
  booking: { date: string; time: string; players: number; pendingNonMembers: number };
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
            {booking.pendingNonMembers !== 1 ? "" : "s"} admin approval. We&apos;ll
            let you know once they&apos;re confirmed.
          </p>
        )}
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
            window.open(cancelUrl, '_blank', 'noopener,noreferrer')
            onDismiss()
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

type BookingGroup = {
  primary: Booking;
  players: Booking[];
};


function groupBookings(bookings: Booking[]): BookingGroup[] {
  const bySlot = new Map<string, Booking[]>();
  for (const b of bookings) {
    const key = `${b.booking_date}_${b.tee_time}`;
    const slot = bySlot.get(key) ?? [];
    slot.push(b);
    bySlot.set(key, slot);
  }
  const groups: BookingGroup[] = [];
  for (const slot of bySlot.values()) {
    const primary = slot.find((b) => b.guest_name === null) ?? slot[0];
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
}: {
  bookings: Booking[];
  onRefresh: () => void;
  onSwitchToBook: () => void;
}) {
  const { user, profile } = useProfile();
  const [openMenu, setOpenMenu] = useState<{
    id: string;
    top: number;
    right: number;
  } | null>(null);
  const [profileMemberId, setProfileMemberId] = useState<string | null>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        openMenu &&
        !(e.target as Element).closest(`[data-menu-id="${openMenu.id}"]`) &&
        !(e.target as Element).closest(`[data-menu-portal="${openMenu.id}"]`)
      ) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [openMenu]);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  const now = new Date();
  const allGroups = groupBookings(bookings);
  const upcoming = allGroups.filter(
    (g) =>
      bookingToLocalDate(g.primary.booking_date, g.primary.tee_time) >= now &&
      g.primary.status !== "cancelled",
  );
  const past = allGroups.filter(
    (g) => bookingToLocalDate(g.primary.booking_date, g.primary.tee_time) < now,
  );

  return (
    <div className="px-5 md:px-8 py-5 pb-8 md:max-w-2xl md:mx-auto">
      <MemberProfileSheet
        memberId={profileMemberId}
        onClose={() => setProfileMemberId(null)}
      />
      <CancelModal
        open={!!cancelTarget}
        bookingDateTime={cancelTarget?.bookingDateTime ?? ""}
        title={cancelTarget?.title ?? "Cancel booking"}
        ghlBookingId={cancelTarget?.ghlBookingId ?? null}
        onDismiss={() => setCancelTarget(null)}
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
              const activePlayers = group.players.filter(
                (p) => p.status !== "cancelled",
              );
              const totalAmount =
                group.primary.amount_charged +
                activePlayers.reduce((sum, p) => sum + p.amount_charged, 0);
              const totalPlayers = 1 + activePlayers.length;

              const iAmBooker = group.primary.member_id === user?.id;
              const allPlayers = iAmBooker
                ? [
                    {
                      id: group.primary.id,
                      name: "You",
                      booking: group.primary,
                      isInvited: false,
                    },
                    ...activePlayers.map((p) => ({
                      id: p.id,
                      name:
                        p.guest_name ??
                        (p.member_id === user?.id ? "You" : "Guest"),
                      booking: p,
                      isInvited: true,
                    })),
                  ]
                : [
                    // Invited view — show only the user's own guest row, labelled "You"
                    {
                      id: group.primary.id,
                      name: "You",
                      booking: group.primary,
                      isInvited: false,
                    },
                  ];

              const playerCanAct = (b: typeof group.primary) =>
                differenceInHours(
                  bookingToLocalDate(b.booking_date, b.tee_time),
                  new Date(),
                ) > 0 &&
                !["awaiting_approval", "tentative", "cancelled", "confirmed"].includes(b.status);

              return (
                <div key={group.primary.id} className="card overflow-hidden">
                  {/* Booking header */}
                  <div className="px-5 pt-5 pb-4">
                    <div className="flex items-center gap-2">
                      <p
                        className="text-sm font-medium"
                        style={{ color: "var(--color-green-900)" }}
                      >
                        {format(
                          bookingToLocalDate(
                            group.primary.booking_date,
                            group.primary.tee_time,
                          ),
                          "EEE, MMM d",
                        )}
                      </p>
                      {!iAmBooker && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{
                            background: "rgba(133,187,101,0.12)",
                            color: "var(--color-green-700)",
                          }}
                        >
                          Invited
                          {group.primary.booker_name
                            ? ` by ${group.primary.booker_name}`
                            : ""}
                        </span>
                      )}
                    </div>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "rgba(0,38,105,0.45)" }}
                    >
                      {format(
                        bookingToLocalDate(
                          group.primary.booking_date,
                          group.primary.tee_time,
                        ),
                        "h:mm a",
                      )}{" "}
                      · ${totalAmount.toFixed(0)}
                      {iAmBooker &&
                        totalPlayers > 1 &&
                        ` · ${totalPlayers} players`}
                    </p>
                  </div>

                  {/* Per-player rows */}
                  <div
                    className="border-t"
                    style={{ borderColor: "rgba(0,38,105,0.07)" }}
                  >
                    {allPlayers.map((player, idx) => {
                      const dt = bookingToLocalDate(
                        player.booking.booking_date,
                        player.booking.tee_time,
                      ).toISOString();
                      const canAct = playerCanAct(player.booking);
                      return (
                        <div
                          key={player.id}
                          className="flex items-center gap-3 px-5 py-3"
                          style={{
                            borderTop:
                              idx === 0
                                ? "none"
                                : "1px solid rgba(0,38,105,0.05)",
                          }}
                        >
                          {/* Avatar — opens member profile sheet */}
                          {(() => {
                            const memberId =
                              player.name === "You"
                                ? (user?.id ?? null)
                                : (player.booking.player_member_id ?? null);
                            const raw =
                              player.name === "You"
                                ? `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim()
                                : player.name;
                            const parts = raw.split(/\s+/).filter(Boolean);
                            const initials =
                              parts.length >= 2
                                ? `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase()
                                : (parts[0]?.[0] ?? "?").toUpperCase();
                            const avatarUrl =
                              player.name === "You"
                                ? (profile?.profile?.avatar_url ?? null)
                                : null;
                            return (
                              <button
                                onClick={() =>
                                  memberId && setProfileMemberId(memberId)
                                }
                                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 overflow-hidden"
                                style={{
                                  background: "rgba(0,38,105,0.08)",
                                  color: "var(--color-green-900)",
                                  cursor: memberId ? "pointer" : "default",
                                }}
                              >
                                {avatarUrl ? (
                                  <Image
                                    src={avatarUrl}
                                    alt=""
                                    width={28}
                                    height={28}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  initials
                                )}
                              </button>
                            );
                          })()}

                          <div className="flex-1 flex items-center gap-1.5 min-w-0">
                            <span
                              className="text-sm font-medium truncate capitalize"
                              style={{ color: "var(--color-green-900)" }}
                            >
                              {player.name}
                            </span>
                            {/* "Invited" pill — shown on guest rows */}
                            {player.isInvited && (
                              <span
                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{
                                  background: "rgba(234,179,8,0.1)",
                                  color: "#92640a",
                                }}
                              >
                                Invited
                              </span>
                            )}
                            {/* "Invited X" — shown on booker's own row when they have guests */}
                            {!player.isInvited &&
                              iAmBooker &&
                              activePlayers.length > 0 && (
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 flex items-center gap-0.5"
                                  style={{
                                    background: "rgba(0,38,105,0.06)",
                                    color: "rgba(0,38,105,0.55)",
                                  }}
                                >
                                  <svg
                                    width="10"
                                    height="10"
                                    viewBox="0 0 16 16"
                                    fill="currentColor"
                                  >
                                    <path d="M5.5 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM1 14s-.5 0-.5-.5C.5 11 2.5 9 5.5 9s5 2 5 4.5c0 .5-.5.5-.5.5H1ZM12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM14.5 13.5h-2c0-1.1-.4-2.1-1-2.9.4-.1.7-.1 1-.1 2 0 3.5 1.6 3.5 3.5 0 .27-.23.5-.5.5Z" />
                                  </svg>
                                  +{activePlayers.length}
                                </span>
                              )}
                          </div>

                          {player.booking.status ===
                          "availability_confirmed" ? (
                            <a
                              href={BOOKING_PAYMENT_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-semibold flex items-center gap-0.5 flex-shrink-0"
                              style={{ color: "#92640a" }}
                            >
                              Pay now
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 12 12"
                                fill="none"
                              >
                                <path
                                  d="M2.5 6h7m-3-3 3 3-3 3"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </a>
                          ) : (
                            <BookingStatusBadge
                              status={player.booking.status}
                            />
                          )}

                          {/* 3-dot menu per player */}
                          {canAct && (
                            <div
                              className="flex-shrink-0"
                              data-menu-id={player.id}
                            >
                              <button
                                onClick={(e) => {
                                  const rect =
                                    e.currentTarget.getBoundingClientRect();
                                  setOpenMenu((prev) =>
                                    prev?.id === player.id
                                      ? null
                                      : {
                                          id: player.id,
                                          top: rect.bottom + 4,
                                          right: window.innerWidth - rect.right,
                                        },
                                  );
                                }}
                                className="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
                                style={{
                                  color: "rgba(0,38,105,0.3)",
                                  background:
                                    openMenu?.id === player.id
                                      ? "rgba(0,38,105,0.06)"
                                      : "transparent",
                                }}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 16 16"
                                  fill="currentColor"
                                >
                                  <circle cx="8" cy="3" r="1.2" />
                                  <circle cx="8" cy="8" r="1.2" />
                                  <circle cx="8" cy="13" r="1.2" />
                                </svg>
                              </button>
                              {openMenu?.id === player.id &&
                                createPortal(
                                  <div
                                    data-menu-portal={player.id}
                                    className="rounded-xl shadow-lg border overflow-hidden z-50"
                                    style={{
                                      position: "fixed",
                                      top: openMenu.top,
                                      right: openMenu.right,
                                      minWidth: 155,
                                      background: "white",
                                      borderColor: "rgba(0,38,105,0.08)",
                                    }}
                                  >
                                    <button
                                      onClick={() => {
                                        setOpenMenu(null);
                                        setCancelTarget({
                                          bookingDateTime: dt,
                                          title: "Cancel booking",
                                          ghlBookingId:
                                            player.booking.ghl_booking_id ??
                                            group.primary.ghl_booking_id ??
                                            null,
                                        });
                                      }}
                                      className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-red-50"
                                      style={{ color: "rgba(220,38,38,0.8)" }}
                                    >
                                      Cancel booking
                                    </button>
                                  </div>,
                                  document.body,
                                )}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
              <div
                key={group.primary.id}
                className="card p-4"
                style={{ opacity: 0.55 }}
              >
                <p
                  className="text-sm"
                  style={{ color: "var(--color-green-900)" }}
                >
                  {format(
                    bookingToLocalDate(
                      group.primary.booking_date,
                      group.primary.tee_time,
                    ),
                    "EEE, MMM d, yyyy",
                  )}
                </p>
                <p
                  className="text-xs mt-0.5"
                  style={{ color: "rgba(0,38,105,0.5)" }}
                >
                  {format(
                    bookingToLocalDate(
                      group.primary.booking_date,
                      group.primary.tee_time,
                    ),
                    "h:mm a",
                  )}
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
