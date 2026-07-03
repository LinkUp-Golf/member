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
  Course,
} from "@/types";
import {
  BOOKING_PRICE_USD,
  POLICY_TIERS,
  GOLF_ROUND_DURATION_MINUTES,
  AVIARA_TIMEZONE,
  GHL_CANCEL_BOOKING_URL,
} from "@/lib/constants";
import { validateEmail } from "@/lib/validation";
import { getBrowserTimezone } from "@/lib/timezone";

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
  const { user, profile } = useProfile();
  const searchParams = useSearchParams();
  const inviteMemberId = searchParams?.get("invite") ?? null;

  const today = useMemo(() => new Date(), []);

  // Timezone — default to the member's saved preference (set via Settings),
  // falling back to the browser-detected zone until a preference exists.
  const [timezone, setTimezone] = useState<string>(getBrowserTimezone);
  useEffect(() => {
    if (profile?.profile?.timezone) setTimezone(profile.profile.timezone);
  }, [profile?.profile?.timezone]);

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

  // Selected course (null = no course chosen yet)
  const [selectedEvent, setSelectedEvent] = useState<Course | null>(null);

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
      const eventParam = selectedEvent ? `&courseId=${selectedEvent.id}` : "";
      const res = await fetch(
        `/api/bookings/create?month=${monthStr}&timezone=${encodeURIComponent(timezone)}${eventParam}`,
      );
      const data = await res.json();
      setMonthSlots(data.slots ?? {});
    } catch {
      setMonthSlots({});
    }
    setLoadingMonth(false);
  }, [currentMonth, timezone, selectedEvent]);

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
    fetch(
      `/api/bookings/day?date=${selectedDate}&timezone=${encodeURIComponent(tz)}`,
    )
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
        fetchMonthSlots();
      } else {
        setError(data.error ?? "Something went wrong. Please try again.");
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
        onBack={() => setStep("select")}
        inviteMemberId={inviteMemberId}
        bookerEmail={user?.email ?? ""}
        eventName={selectedEvent?.name ?? null}
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
        !selectedEvent ? (
          <EventSelectionScreen
            onSelect={(ev) => {
              setSelectedEvent(ev);
              setSelectedSlot(null);
              setMonthSlots({});
            }}
          />
        ) : (
          <div className="pb-8 md:max-w-2xl md:mx-auto">
            {/* Selected event banner */}
            <div
              className="px-5 md:px-8 pt-3 pb-2 flex items-center justify-between"
              style={{ borderBottom: "1px solid rgba(0,38,105,0.06)" }}
            >
              <div>
                <p
                  className="text-xs font-semibold"
                  style={{ color: "var(--color-green-900)" }}
                >
                  {selectedEvent.name}
                </p>
                {(selectedEvent.city || selectedEvent.state) && (
                  <p
                    className="text-[10px] mt-0.5"
                    style={{ color: "rgba(0,38,105,0.4)" }}
                  >
                    {[selectedEvent.city, selectedEvent.state]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedEvent(null);
                  setMonthSlots({});
                  setSelectedSlot(null);
                }}
                className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{
                  background: "rgba(0,38,105,0.06)",
                  color: "rgba(0,38,105,0.55)",
                }}
              >
                Change
              </button>
            </div>
            {/* Month navigation + view toggle */}
            <div className="px-5 md:px-8 pt-4 pb-2 flex items-center justify-between">
              <div className="flex-1 flex items-center justify-between mr-3">
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

              <div
                className="flex rounded-lg flex-shrink-0"
                style={{ background: "rgba(0,38,105,0.06)" }}
              >
                {(["day", "month"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className="h-9 px-2.5 py-1 text-xs font-semibold rounded-md capitalize transition-all"
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
                              color: active
                                ? "white"
                                : "var(--color-green-900)",
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
              Availability is confirmed by the team — payment link sent by
              email.
            </p>
          </div>
        )
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
  const cells: (number | null)[] = Array.from(
    { length: totalCells },
    (_, i) => {
      const d = i - startDow + 1;
      return d >= 1 && d <= daysInMonth ? d : null;
    },
  );

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
                "relative flex flex-col items-center justify-center aspect-square rounded-xl transition-all duration-150",
                isPast
                  ? "opacity-40"
                  : !hasSlots && !isToday
                    ? "opacity-50"
                    : "",
                !canClick
                  ? "cursor-not-allowed"
                  : active
                    ? ""
                    : "hover:bg-green-50/60",
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

import type { MemberDetail } from "@/components/ui/MemberProfileSheet";

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
    ? "You"
    : prof?.display_name || `${player.first_name} ${player.last_name}`.trim();
  const initials =
    `${player.first_name[0] ?? ""}${player.last_name[0] ?? ""}`.toUpperCase();
  const avatarUrl = prof?.avatar_url ?? player.avatar_url;
  // tee_time is stored in course-local timezone; display it directly.
  const localTeeTime = player.tee_time;

  return (
    <>
      <button
        type="button"
        onClick={player.is_self ? undefined : openPopover}
        className="flex flex-col items-center gap-1 flex-shrink-0 w-14 transition-opacity active:opacity-60"
        style={{ cursor: player.is_self ? "default" : undefined }}
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
      {booking.bookingId && (
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
            bookingId={booking.bookingId}
            current={dinnerRsvp}
            layout="horizontal"
            autoSave={false}
            onSaved={setDinnerRsvp}
          />
        </div>
      )}
      {!booking.bookingId && <div className="mb-8" />}
      <button
        onClick={handleDone}
        disabled={(!!booking.bookingId && dinnerRsvp === null) || submitting}
        className="btn btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? "Saving…" : "Back to booking"}
      </button>
      {booking.bookingId && dinnerRsvp === null && (
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
  onSaved: (bookingId: string, guestName: string, player: AdditionalPlayer) => void;
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
  const inputStyle = { borderColor: "rgba(0,38,105,0.12)", color: "var(--color-green-900)" };

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
}: {
  bookings: Booking[];
  onRefresh: () => void;
  onSwitchToBook: () => void;
  onUpdateBooking: (bookingId: string, updates: Partial<Booking>) => void;
}) {
  const { user } = useProfile();
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [editTarget, setEditTarget] = useState<EditGuestTarget | null>(null);

  const now = new Date();
  const allGroups = groupBookings(bookings);
  const upcoming = allGroups.filter(
    (g) =>
      bookingToLocalDate(g.primary.booking_date, g.primary.tee_time, g.primary.course?.timezone) >= now &&
      g.primary.status !== "cancelled",
  );
  const cancelledAndPast = allGroups
    .filter(
      (g) =>
        bookingToLocalDate(g.primary.booking_date, g.primary.tee_time, g.primary.course?.timezone) < now ||
        g.primary.status === "cancelled",
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
              const courseName = group.primary.course?.name ?? "Aviara";
              const isCancelled = group.primary.status === "cancelled";

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
                  {isCancelled && <BookingStatusBadge status="cancelled" />}
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
}: {
  group: BookingGroup;
  userId: string | undefined;
  onCancel: (target: CancelTarget) => void;
  onEditGuest: (target: EditGuestTarget) => void;
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
  const courseName = group.primary.course?.name ?? "Aviara";
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
            p.status === "awaiting_approval" ? (p.additional_players?.[0] ?? null) : null,
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
                        style={{ background: "rgba(234,179,8,0.15)", color: "#92640a" }}
                        aria-label={`Admin note: ${row.adminNotes}`}
                      >
                        ⚠
                      </span>
                      <div
                        className="absolute left-0 bottom-full mb-1.5 hidden group-hover:block w-56 max-w-[70vw] rounded-lg px-3 py-2 text-[11px] leading-snug shadow-lg z-20"
                        style={{ background: "var(--color-green-900)", color: "white" }}
                      >
                        {row.adminNotes}
                      </div>
                    </div>
                  )}
                </div>

                {/* Status badge or Pay CTA */}
                {!canPay && <BookingStatusBadge status={row.status} />}
                {canPay && (
                  group.primary.course?.payment_url ? (
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
                  )
                )}

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
        </div>
      )}
    </div>
  );
}

// ---- Event selection screen ---------------------------------

type BookableCourse = Course & { has_access: boolean; access_requested: boolean };

function EventSelectionScreen({
  onSelect,
}: {
  onSelect: (course: Course) => void;
}) {
  const [events, setEvents] = useState<BookableCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateFeed, setShowCreateFeed] = useState(false);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

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

  async function requestAccess(courseId: string) {
    setRequestingId(courseId);
    try {
      const res = await fetch("/api/event-access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course_id: courseId }),
      });
      if (res.ok) {
        setEvents((prev) =>
          prev.map((c) => (c.id === courseId ? { ...c, access_requested: true } : c)),
        );
      } else {
        setActionError("Failed to request access. Please try again.");
        setTimeout(() => setActionError(""), 3500);
      }
    } finally {
      setRequestingId(null);
    }
  }

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
    <div className="pb-8 md:max-w-2xl md:mx-auto">
      <div className="px-5 md:px-8 pt-5 pb-2">
        <p className="section-label mb-1">Select an event to book</p>
        <p className="text-xs" style={{ color: "rgba(0,38,105,0.4)" }}>
          Choose an event below to see available times.
        </p>
        {actionError && (
          <p className="text-xs mt-1.5" style={{ color: "rgba(220,38,38,0.85)" }}>
            {actionError}
          </p>
        )}
      </div>

      <div className="px-5 md:px-8 pt-3">
        <div className="card">
          {events.map((course, i) => {
            const borderStyle = {
              borderBottom: i < events.length - 1 ? "1px solid rgba(0,38,105,0.06)" : "none",
            };

            return course.has_access ? (
              <button
                key={course.id}
                type="button"
                onClick={() => onSelect(course)}
                className="w-full text-left flex items-start gap-3 px-4 py-4 transition-colors hover:bg-green-50/40 active:opacity-70"
                style={borderStyle}
              >
                <CourseRowInner
                  course={course}
                  isRequesting={requestingId === course.id}
                  onRequestAccess={requestAccess}
                />
              </button>
            ) : (
              <div
                key={course.id}
                className="w-full text-left flex items-start gap-3 px-4 py-4"
                style={borderStyle}
              >
                <CourseRowInner
                  course={course}
                  isRequesting={requestingId === course.id}
                  onRequestAccess={requestAccess}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CourseRowInner({
  course,
  isRequesting,
  onRequestAccess,
}: {
  course: BookableCourse;
  isRequesting: boolean;
  onRequestAccess: (courseId: string) => void;
}) {
  return (
    <>
      {/* Venue logo — fixed square, pinned to the top so it never
          stretches/shrinks based on how tall the text stack next to
          it gets (e.g. whether the website icon row is present). */}
      <div
        className="relative w-24 h-24 aspect-square self-start rounded-xl overflow-hidden flex-shrink-0"
        style={{ background: "rgba(0,38,105,0.03)" }}
      >
        <Image
          src={course.logo_url}
          alt=""
          fill
          unoptimized
          className="object-contain"
        />
      </div>

      {/* Row stack: name / location - address / price / access CTA / website icon */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p
          className="font-sans font-black text-base leading-tight truncate"
          style={{ color: "var(--color-green-900)" }}
        >
          {course.name}
        </p>

        {(course.city || course.state || course.address) && (
          <p
            className="text-xs truncate"
            style={{ color: "rgba(0,38,105,0.45)" }}
          >
            📍 {[course.city, course.state].filter(Boolean).join(", ")}
            {course.address ? ` - ${course.address}` : ""}
          </p>
        )}

        {course.cost_per_player != null && (
          <span
            className="text-xs font-bold"
            style={{ color: "var(--color-gold-dark, #92640a)" }}
          >
            ${course.cost_per_player}/player
          </span>
        )}

        {!course.has_access && (
          <div className="flex justify-end -mb-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!course.access_requested) onRequestAccess(course.id);
              }}
              disabled={course.access_requested || isRequesting}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-60"
              style={{ background: "rgba(0,38,105,0.06)", color: "var(--color-green-900)" }}
            >
              {course.access_requested
                ? "Access requested"
                : isRequesting
                  ? "Requesting…"
                  : "Request access"}
            </button>
          </div>
        )}

        {course.booking_url && (
          <div className="flex justify-end -mb-1">
            <a
              href={course.booking_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label="Visit website"
              className="flex items-center justify-center w-6 h-6 flex-shrink-0 transition-opacity hover:opacity-60"
              style={{ color: "rgba(0,38,105,0.35)" }}
            >
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
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </a>
          </div>
        )}
      </div>
    </>
  );
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
              className="block text-xs font-semibold mb-1.5"
              style={{ color: "rgba(0,38,105,0.55)" }}
            >
              Feed name
            </label>
            <input
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
