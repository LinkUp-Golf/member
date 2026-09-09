"use client";

// Aggregated month view of tee-time availability across every bookable venue.
//
// Responsive strategy — the two breakpoints show the same month, not the same
// layout, because a Google-Calendar grid is only legible once cells are wide
// enough to hold a venue name:
//
//   md and up  — the real month grid. Tall cells, venue name chips inside each
//                day, "+N more" past what fits. Reading across a week is the
//                point, so the grid is the primary surface.
//   below md   — the grid shrinks to a dot map: one dot per venue open that
//                day, sized for a thumb, still showing the shape of the month
//                at a glance. The detail moves to the agenda beneath it, which
//                lists whole days as cards — no truncation, no pinching.
//
// The agenda is not a mobile-only fallback: it renders at every width as the
// day panel under the grid. Below md it simply carries the whole month when no
// day is selected, so a member always has something readable to scroll.

import { memo, useMemo } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  MapPin,
} from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  format,
  isSameMonth,
  isToday,
} from "date-fns";
import { cn, formatTeeTime } from "@/lib/utils";
import { BOOKING_PRICE_USD } from "@/lib/constants";
import { formatRoundPrice } from "@/lib/bookings/price";
import { Spinner } from "@/components/ui/Loading";
import { useStickyHeaderOffset } from "@/hooks/useStickyHeaderOffset";
import {
  VENUE_DOT as DOT,
  VENUE_TEXT as TEXT,
  VENUE_CHIP as CHIP,
  buildVenueColours,
} from "@/components/calendar/venue-colours";

// Mirrors CalendarVenue / CalendarOpening from @/lib/bookings/availability —
// declared here too so the component stays a pure presentational unit that a
// test or a story can feed by hand.
export interface CalendarVenue {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  /** Green fee, already resolved server-side — the cards quote it verbatim. */
  pricePerPlayer: number;
}

export interface CalendarTee {
  /** Wall-clock 'HH:mm:ss' at the venue. */
  time: string;
  spotsOpen: number;
}

export interface CalendarOpening {
  courseId: string;
  /** Bookable tee times that day. */
  openSlots: number;
  /** Seats across them, already clamped to the venue's daily cap. */
  openSpots: number;
  /** Earliest few tee times. */
  tees: CalendarTee[];
}

const WEEKDAYS = [
  ["Sunday", "Sun", "S"],
  ["Monday", "Mon", "M"],
  ["Tuesday", "Tue", "T"],
  ["Wednesday", "Wed", "W"],
  ["Thursday", "Thu", "T"],
  ["Friday", "Fri", "F"],
  ["Saturday", "Sat", "S"],
] as const;

const iso = (d: Date) => format(d, "yyyy-MM-dd");

// Stable empty arrays so days with nothing open — and a screen with nothing
// pinned — keep a constant prop reference (a fresh `[]` per render would
// defeat DayCell's memo, and this component's own).
const EMPTY: CalendarOpening[] = [];
const EMPTY_VENUES: PinnedVenue[] = [];
const EMPTY_NEXT: Record<string, PinnedNextOpening | null> = {};

const venueLocation = (v: CalendarVenue | undefined) =>
  [v?.city, v?.state].filter(Boolean).join(", ");

// ---- One day cell (memoized) --------------------------------

interface DayCellProps {
  date: Date;
  dayIso: string;
  inMonth: boolean;
  today: boolean;
  past: boolean;
  selected: boolean;
  openings: CalendarOpening[];
  colourByVenue: Map<string, number>;
  nameByVenue: Map<string, string>;
  onSelect: (dayIso: string) => void;
}

const DayCell = memo(function DayCell({
  date,
  dayIso,
  inMonth,
  today,
  past,
  selected,
  openings,
  colourByVenue,
  nameByVenue,
  onSelect,
}: DayCellProps) {
  const has = openings.length > 0;
  // Any upcoming day in the month opens — landing on an empty one and being
  // told so beats a tap that does nothing.
  const selectable = inMonth && !past;

  const label = `${format(date, "EEEE, MMMM d")} — ${
    has
      ? `${openings.length} venue${openings.length === 1 ? "" : "s"} with tee times`
      : "nothing open"
  }`;

  // Three chips is what a cell holds at md without the row growing; the rest
  // roll up into a count that the agenda below spells out.
  const shown = openings.length > 3 ? openings.slice(0, 2) : openings;
  const extra = openings.length - shown.length;

  return (
    <button
      type="button"
      disabled={!selectable}
      aria-label={label}
      aria-pressed={selected}
      aria-current={today ? "date" : undefined}
      onClick={() => onSelect(dayIso)}
      className={cn(
        "flex flex-col rounded-lg transition-colors text-left",
        "min-h-[3rem] p-1 items-center",
        "md:min-h-[6.5rem] md:p-1.5 md:items-stretch md:border md:border-green-900/[0.07]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-1",
        !inMonth && "invisible",
        past && inMonth && "opacity-40",
        selected && "md:border-green-900 md:bg-green-50/40",
        selectable && !selected && "hover:bg-green-50/70",
      )}
    >
      {/* Date number — centred over the dots on mobile, top-left of the cell at
          md where the chips need the width. */}
      <span className="flex-1 flex items-center justify-center md:flex-none md:justify-start md:mb-1">
        <span
          className={cn(
            "w-6 h-6 md:w-6 md:h-6 rounded-full flex items-center justify-center",
            "text-[11px] md:text-xs leading-none tabular-nums",
            selected
              ? "bg-green-900 text-white font-semibold"
              : today
                ? "ring-1 ring-green-700/60 text-green-800 font-bold"
                : has
                  ? "text-green-950 font-semibold"
                  : "text-green-900/40 font-medium",
          )}
        >
          {format(date, "d")}
        </span>
      </span>

      {/* Below md — a dot per venue. The slot is reserved even on empty days so
          every date in a row sits at the same height. */}
      <span className="md:hidden h-2.5 flex items-center justify-center gap-0.5">
        {openings.slice(0, 3).map((o) => (
          <span
            key={o.courseId}
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              DOT[colourByVenue.get(o.courseId) ?? 0],
            )}
          />
        ))}
        {openings.length > 3 && (
          <span className="text-[9px] font-medium leading-none text-green-900/50">
            +{openings.length - 3}
          </span>
        )}
      </span>

      {/* md and up — the venue names themselves, which is what makes the grid
          worth showing at this width. */}
      <span className="hidden md:flex flex-col gap-0.5 overflow-hidden">
        {shown.map((o) => {
          const idx = colourByVenue.get(o.courseId) ?? 0;
          return (
            <span
              key={o.courseId}
              className={cn(
                "flex items-center gap-1 rounded px-1 py-0.5 border text-[10px] leading-tight",
                CHIP[idx],
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  DOT[idx],
                )}
              />
              <span className={cn("truncate font-medium", TEXT[idx])}>
                {nameByVenue.get(o.courseId) ?? "Venue"}
              </span>
            </span>
          );
        })}
        {extra > 0 && (
          <span className="text-[10px] leading-tight text-green-900/50 px-1">
            +{extra} more
          </span>
        )}
      </span>
    </button>
  );
});

// ---- Agenda row ---------------------------------------------

function AgendaDay({
  dayIso,
  openings,
  venuesById,
  colourByVenue,
  onPickOpening,
  showDate,
}: {
  dayIso: string;
  openings: CalendarOpening[];
  venuesById: Map<string, CalendarVenue>;
  colourByVenue: Map<string, number>;
  onPickOpening: (courseId: string, date: string) => void;
  showDate: boolean;
}) {
  const date = new Date(`${dayIso}T12:00:00`);

  return (
    <div className="flex gap-3">
      {showDate && (
        <div className="flex-shrink-0 w-11 pt-1 text-center">
          <p className="text-[10px] uppercase tracking-wider font-medium text-green-900/40">
            {format(date, "EEE")}
          </p>
          <p
            className={cn(
              "font-sans font-black text-xl leading-tight",
              isToday(date) ? "text-green-700" : "text-green-950",
            )}
          >
            {format(date, "d")}
          </p>
        </div>
      )}

      <div className="flex-1 min-w-0 space-y-2">
        {openings.map((o) => {
          const venue = venuesById.get(o.courseId);
          const idx = colourByVenue.get(o.courseId) ?? 0;
          const location = venueLocation(venue);
          // venuesById is built from the same month payload as these openings,
          // so the fallback is defensive only — and it's the same house default
          // the price helper lands on when a venue has set no rate.
          const price = venue?.pricePerPlayer ?? BOOKING_PRICE_USD;

          return (
            <button
              key={o.courseId}
              type="button"
              onClick={() => onPickOpening(o.courseId, dayIso)}
              className="group w-full text-left flex items-center gap-3 rounded-xl border border-green-900/10 bg-white px-3 py-2.5 transition-colors hover:bg-green-50/50 active:opacity-70"
            >
              <span
                className={cn(
                  "w-1 self-stretch rounded-full flex-shrink-0",
                  DOT[idx],
                )}
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-green-950 truncate">
                  {venue?.name ?? "Venue"}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-green-900/45">
                  {o.tees[0] && (
                    <>
                      <span className="flex items-center gap-1">
                        <Clock
                          className="w-3 h-3 flex-shrink-0"
                          strokeWidth={2}
                        />
                        {formatTeeTime(o.tees[0].time)}
                      </span>
                      <span aria-hidden className="text-green-900/25">
                        ·
                      </span>
                    </>
                  )}
                  {/* The price, not the seat count: what decides whether to
                      open this card is what the round costs, and a day with a
                      single seat left is still a day worth booking. */}
                  <span className={cn("font-medium", TEXT[idx])}>
                    {formatRoundPrice(price)}/player
                  </span>
                </span>
                {location && (
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-green-900/40">
                    <MapPin className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                    <span className="truncate">{location}</span>
                  </span>
                )}
              </span>
              <BookIndicator />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What the card does, said rather than implied.
 *
 * Every venue card on this screen ended in a bare chevron, which announces
 * "there is more of this" — a detail page, a longer list. What actually
 * happens is a booking, and a member reading the row had no way to know that
 * without tapping it. The word is the whole fix; the chevron stays as the
 * direction of travel.
 *
 * Small enough to sit inside a row that also carries a venue name, a time and
 * a price, so it reads as the row's action rather than a second headline.
 */
function BookIndicator({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 rounded-full pl-2.5 pr-1.5 py-1 flex-shrink-0",
        "text-[11px] font-bold uppercase tracking-wide transition-colors",
        tone === "dark"
          ? "bg-white/10 text-gold group-hover:bg-white/20"
          : "bg-green-50 text-green-800 group-hover:bg-green-100",
      )}
    >
      Book
      <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.4} />
    </span>
  );
}

// ---- Pinned venue dock --------------------------------------

/**
 * A pinned venue, as the dock needs it. The logo is the difference from the
 * agenda's `CalendarVenue`: the dock leads with the club's own mark rather than
 * a colour bar, so the card is recognisable before it's read.
 */
export interface PinnedVenue extends CalendarVenue {
  logoUrl?: string | null;
}

/**
 * A pinned venue's next open day anywhere ahead, for when the visible month has
 * none of its own. Fetched per venue from GET /api/courses/[id]/next-available.
 */
export interface PinnedNextOpening {
  /** 'YYYY-MM-DD' at the venue. */
  date: string;
  /** Bookable tee times that day — sizes the day sheet's loading placeholder. */
  openSlots: number;
  tees: CalendarTee[];
}

/**
 * The pinned venues, docked above the agenda and stuck there while it scrolls.
 *
 * The agenda answers "what is open, in date order" — a venue we want members
 * to see first loses that position as soon as another club opens earlier in
 * the month. So a pinned venue is lifted out of the list and shown as itself:
 * the club, and the next day it has tee times. Tapping it opens that day.
 *
 * These cards are dark where everything around them is white. That is the
 * whole of the treatment and it's deliberate: the first pass styled them like
 * the agenda rows they sit above, which made the one card meant to stand out of
 * that list read as a member of it. Inverting to the app's own navy — the
 * colour of its nav and its header — says "not one of these" in one move,
 * without a badge, a ribbon, a label or a second border. Nothing on the card
 * announces that it's pinned: being the only dark card on the screen is the
 * announcement, and a member doesn't need the mechanism named. The venue's
 * palette colour goes too; gold is the accent on navy everywhere else in the
 * app, and a card that isn't in the month grid has no dots up there to match.
 *
 * When the visible month has nothing for it, the card shows the venue's next
 * open day from wherever it falls — `nextAvailable`, looked up a month at a
 * time by the server. A featured club with a quiet August should point at the
 * month it does have something in rather than disappear until the member
 * happens to page onto it.
 *
 * Tapping opens that day either way. A date in another month is still a day at
 * a venue, and the sheet fetches its own tee times for whatever date it's given
 * — so paging the calendar there first would be a step the member has to take
 * before getting what they asked for.
 *
 * Only a venue with nothing at all — not this month, not in the year ahead —
 * is dropped. There is nothing to send the member to.
 *
 * More than one can be pinned (up to MAX_PINNED_COURSES). Past the first, the
 * cards lose their location line — the dock holds its place on screen, so every
 * row it grows by is a row of the calendar the member can't see.
 *
 * The filters above don't reach it. Pinning is the one thing on this screen
 * that isn't the member's own choice of what to look at — a venue we've put in
 * front of them stays in front of them, which is the whole reason to have it.
 * So the dock reads the unfiltered month, not the narrowed one.
 */
function PinnedVenueDock({
  venues,
  days,
  month,
  nextAvailable,
  onPickOpening,
  todayIso,
}: {
  venues: PinnedVenue[];
  /** 'YYYY-MM-DD' → the venues open that day, unfiltered. */
  days: Record<string, CalendarOpening[]>;
  month: Date;
  /** courseId → its next open day anywhere ahead; absent while still loading. */
  nextAvailable: Record<string, PinnedNextOpening | null>;
  /** Opens the day, whichever month it falls in. */
  onPickOpening: (courseId: string, date: string) => void;
  todayIso: string;
}) {
  const top = useStickyHeaderOffset();

  // The next day each pinned venue is open, this month. Today counts; a day
  // already gone does not.
  const nextByVenue = useMemo(() => {
    const out = new Map<string, { date: string; opening: CalendarOpening }>();
    const dates = Object.keys(days)
      .filter(
        (d) => d >= todayIso && isSameMonth(new Date(`${d}T12:00:00`), month),
      )
      .sort();
    for (const date of dates) {
      for (const opening of days[date] ?? []) {
        if (!out.has(opening.courseId))
          out.set(opening.courseId, { date, opening });
      }
    }
    return out;
  }, [days, month, todayIso]);

  // What each card will say: this month's day where there is one, else the
  // venue's next from anywhere ahead. A venue with neither has nothing to
  // offer and doesn't appear.
  const cards = venues.flatMap((venue) => {
    const here = nextByVenue.get(venue.id);
    if (here) {
      return [
        {
          venue,
          date: here.date,
          tee: here.opening.tees[0],
          inMonth: true,
        },
      ];
    }
    const ahead = nextAvailable[venue.id];
    if (!ahead) return [];
    return [
      {
        venue,
        date: ahead.date,
        tee: ahead.tees[0],
        inMonth: false,
      },
    ];
  });

  if (cards.length === 0) return null;

  const compact = cards.length > 1;
  const thisYear = new Date().getFullYear();

  return (
    // Opaque, or the agenda would scroll through it. Bled 4px sideways (and
    // padded back) so the cards' shadows land on the dock's own background
    // instead of being cut off at its edge.
    <div
      className="sticky z-10 -mx-1 px-1 pt-1 pb-2.5 bg-cream"
      style={{ top }}
    >
      <div className="space-y-2">
        {cards.map(({ venue, date, tee, inMonth }) => {
          const location = venueLocation(venue);
          const when = new Date(`${date}T12:00:00`);
          // The year only earns its place once the date isn't in this one —
          // which, for a venue whose next opening is months out, it may not be.
          const dateLabel = format(
            when,
            when.getFullYear() === thisYear ? "EEE, MMM d" : "EEE, MMM d yyyy",
          );

          return (
            <button
              key={venue.id}
              type="button"
              onClick={() => onPickOpening(venue.id, date)}
              // Navy with a little depth, so the card reads as a surface
              // rather than a block of colour.
              className="group w-full text-left flex items-center gap-3 rounded-2xl px-3 py-3 bg-gradient-to-br from-green-900 to-green-950 shadow-lg shadow-green-950/20 transition-opacity active:opacity-80"
            >
              {/* White tile behind the mark. Club logos are dark artwork on
                  transparent backgrounds — dropped straight onto the navy most
                  of them would simply disappear.
                  `aspect-square` alongside the w/h so the tile can't be pulled
                  out of square by a long venue name or the location line, the
                  same guarantee the admin venue rows use. */}
              <span className="relative w-20 h-20 aspect-square rounded-xl overflow-hidden flex-shrink-0 bg-white">
                {venue.logoUrl ? (
                  <Image
                    src={venue.logoUrl}
                    alt=""
                    fill
                    unoptimized
                    className="object-contain p-1"
                  />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-base font-black text-green-900">
                    {venue.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>

              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-bold text-white truncate">
                  {venue.name}
                </span>

                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/65">
                  <span>
                    {/* Said out loud when the day isn't in the month on screen,
                        so a date that reads as out of place has a reason. */}
                    {inMonth ? dateLabel : `Next open ${dateLabel}`}
                  </span>
                  {tee && (
                    <>
                      <span aria-hidden className="text-white/25">
                        ·
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock
                          className="w-3 h-3 flex-shrink-0"
                          strokeWidth={2}
                        />
                        {formatTeeTime(tee.time)}
                      </span>
                    </>
                  )}
                  <span aria-hidden className="text-white/25">
                    ·
                  </span>
                  {/* The number that decides whether it's worth acting on, so
                      it gets the accent rather than the date beside it. */}
                  <span className="font-semibold text-gold">
                    {formatRoundPrice(venue.pricePerPlayer)}/player
                  </span>
                </span>

                {/* /55 rather than lower: 11px on navy is already at the edge
                    of legible, and this is the line most likely to be read at
                    arm's length. */}
                {location && !compact && (
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-white/55">
                    <MapPin className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                    <span className="truncate">{location}</span>
                  </span>
                )}
              </span>

              {/* Same indicator as the agenda rows below, in the dock's own
                  palette — one card saying "Book" and the next only hinting at
                  it would read as two different kinds of row. */}
              <BookIndicator tone="dark" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Month calendar -----------------------------------------

interface VenueAvailabilityCalendarProps {
  /** Any date within the visible month. */
  month: Date;
  venues: CalendarVenue[];
  /** 'YYYY-MM-DD' → the venues with tee times open that day. */
  days: Record<string, CalendarOpening[]>;
  loading: boolean;
  /** null = no day picked; below md the agenda then carries the whole month. */
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onMonthChange: (month: Date) => void;
  canGoPrev?: boolean;
  /**
   * Venue ids to plot, or null for all of them. The search box, the location
   * filter and the venue focus all land here as one already-resolved list, so
   * the grid has a single rule to apply. Colours still come from `venues` (the
   * full month), so narrowing the set never re-colours what's left.
   */
  allowedVenueIds: string[] | null;
  /** Clears every venue narrowing at once; null when there's nothing to clear. */
  onClearVenueFilters: (() => void) | null;
  /**
   * Venues an admin has pinned. Docked above the agenda and kept stuck there
   * while it scrolls, showing the next day each one is open. Passed separately
   * from `venues` because the dock needs the club's logo, which the month
   * payload doesn't carry.
   */
  pinnedVenues?: PinnedVenue[];
  /**
   * Each pinned venue's next open day from anywhere ahead, keyed by course id —
   * what a card falls back to when the visible month has nothing for it. An
   * absent key is "still loading"; an explicit null is "nothing in the year
   * ahead", and that venue drops out of the dock.
   */
  pinnedNextAvailable?: Record<string, PinnedNextOpening | null>;
  /** Booking a specific venue on a specific day. */
  onPickOpening: (courseId: string, date: string) => void;
}

function VenueAvailabilityCalendar({
  month,
  venues,
  days,
  loading,
  selectedDate,
  onSelectDate,
  onMonthChange,
  canGoPrev = true,
  allowedVenueIds,
  onClearVenueFilters,
  onPickOpening,
  pinnedVenues = EMPTY_VENUES,
  pinnedNextAvailable = EMPTY_NEXT,
}: VenueAvailabilityCalendarProps) {
  const todayIso = useMemo(() => iso(new Date()), []);

  const { colourByVenue, nameByVenue, venuesById } = useMemo(() => {
    // Colours follow the venue list — sorted by name server-side — so a venue
    // keeps its colour no matter which days it happens to be open.
    const colourByVenue = buildVenueColours(venues.map((v) => v.id));
    const nameByVenue = new Map(venues.map((v) => [v.id, v.name]));
    const venuesById = new Map(venues.map((v) => [v.id, v]));
    return { colourByVenue, nameByVenue, venuesById };
  }, [venues]);

  // Kept separate from the colour assignment so filtering never re-colours a
  // venue — a club has to keep its colour while the grid narrows.
  const allowed = useMemo(
    () => (allowedVenueIds ? new Set(allowedVenueIds) : null),
    [allowedVenueIds],
  );

  const visibleDays = useMemo(() => {
    if (!allowed) return days;
    const out: Record<string, CalendarOpening[]> = {};
    for (const [day, list] of Object.entries(days)) {
      const kept = list.filter((o) => allowed.has(o.courseId));
      if (kept.length) out[day] = kept;
    }
    return out;
  }, [days, allowed]);

  // A fixed 6-week grid would keep the height stable, but an agenda sits right
  // below it — trailing blank weeks would just push it down, so the grid ends
  // with the month.
  const gridDays = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
    const out: Date[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  // Every day in the month that has something open, ascending — what the agenda
  // walks when no single day is selected.
  const agendaDays = useMemo(
    () =>
      Object.keys(visibleDays)
        .filter((d) => isSameMonth(new Date(`${d}T12:00:00`), month))
        .sort(),
    [visibleDays, month],
  );

  const monthOpeningCount = useMemo(
    () => agendaDays.reduce((n, d) => n + (visibleDays[d]?.length ?? 0), 0),
    [agendaDays, visibleDays],
  );

  // `days`, not `visibleDays` — the dock is deliberately outside the filters, so
  // narrowing the month to another club must not turn a pinned venue's real day
  // this month into a "next open" one in some later month.
  //
  // No colour map: the dock's cards are navy, where the venue palette is a set
  // of light-background text colours, and a card showing a date in another
  // month has no dots on this calendar to be matched to anyway.
  const pinnedDock = pinnedVenues.length > 0 && (
    <PinnedVenueDock
      venues={pinnedVenues}
      days={days}
      month={month}
      nextAvailable={pinnedNextAvailable}
      onPickOpening={onPickOpening}
      todayIso={todayIso}
    />
  );

  const onCurrentMonth = isSameMonth(month, new Date());
  const selectedOpenings = selectedDate
    ? (visibleDays[selectedDate] ?? [])
    : [];
  // Only worth naming the survivor when the filters left exactly one venue —
  // past that, "your filters" is the honest description of what emptied the
  // month.
  const survivingVenues = allowed
    ? venues.filter((v) => allowed.has(v.id))
    : venues;
  const soleVenueName =
    survivingVenues.length === 1 ? (survivingVenues[0]?.name ?? null) : null;
  const narrowed = onClearVenueFilters !== null;

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, -1))}
            disabled={!canGoPrev}
            aria-label="Previous month"
            className="w-9 h-9 rounded-full flex items-center justify-center text-green-900/60 hover:bg-green-50 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <p
              aria-live="polite"
              className="text-sm font-bold text-green-950 truncate"
            >
              {format(month, "MMMM yyyy")}
            </p>
            {!onCurrentMonth && (
              <button
                type="button"
                onClick={() => onMonthChange(startOfMonth(new Date()))}
                className="px-2 py-0.5 rounded-full text-[11px] font-semibold text-green-800 bg-green-900/[0.07] hover:bg-green-900/10 flex-shrink-0"
              >
                Today
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(month, 1))}
            aria-label="Next month"
            className="w-9 h-9 rounded-full flex items-center justify-center text-green-900/60 hover:bg-green-50"
          >
            <ChevronRight className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>

        {/* Weekday header — initials on the dot map, short names once the cells
            are wide enough to carry them. */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map(([full, short, initial]) => (
            <div
              key={full}
              className="text-center md:text-left md:px-1.5 text-[10px] md:text-xs font-medium text-green-900/40 py-1"
            >
              <span className="sr-only">{full}</span>
              <span aria-hidden className="md:hidden">
                {initial}
              </span>
              <span aria-hidden className="hidden md:inline">
                {short}
              </span>
            </div>
          ))}
        </div>

        <div className="relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/70">
              <Spinner className="w-5 h-5 text-green-900" />
            </div>
          )}
          <div className="grid grid-cols-7 gap-1">
            {gridDays.map((d) => {
              const dayIso = iso(d);
              const inMonth = isSameMonth(d, month);
              return (
                <DayCell
                  key={dayIso}
                  date={d}
                  dayIso={dayIso}
                  inMonth={inMonth}
                  today={isToday(d)}
                  past={dayIso < todayIso}
                  selected={selectedDate === dayIso}
                  openings={inMonth ? (visibleDays[dayIso] ?? EMPTY) : EMPTY}
                  colourByVenue={colourByVenue}
                  nameByVenue={nameByVenue}
                  onSelect={
                    dayIso === selectedDate
                      ? () => onSelectDate(null)
                      : onSelectDate
                  }
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Agenda — the selected day, or the whole month when none is picked. */}
      {!loading &&
        (selectedDate ? (
          <div>
            {pinnedDock}
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h3 className="text-sm font-bold text-green-950">
                {format(new Date(`${selectedDate}T12:00:00`), "EEEE, MMMM d")}
              </h3>
              <button
                type="button"
                onClick={() => onSelectDate(null)}
                className="text-[11px] font-semibold text-green-800 hover:underline flex-shrink-0"
              >
                Whole month
              </button>
            </div>
            {selectedOpenings.length > 0 ? (
              <AgendaDay
                dayIso={selectedDate}
                openings={selectedOpenings}
                venuesById={venuesById}
                colourByVenue={colourByVenue}
                onPickOpening={onPickOpening}
                showDate={false}
              />
            ) : (
              <div className="card card-pad text-center py-8">
                <p className="text-sm text-green-900/60">
                  {soleVenueName
                    ? `No tee times at ${soleVenueName} on this day.`
                    : narrowed
                      ? "No tee times match your filters on this day."
                      : "No tee times open on this day."}
                </p>
                <p className="text-xs text-green-900/40 mt-1">
                  {monthOpeningCount > 0
                    ? "Pick a highlighted day above."
                    : "Try another month."}
                </p>
              </div>
            )}
          </div>
        ) : agendaDays.length > 0 ? (
          <div>
            {pinnedDock}
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h3 className="text-sm font-bold text-green-950">
                Everything in {format(month, "MMMM")}
              </h3>
              <span className="text-[11px] text-green-900/45 flex-shrink-0">
                {agendaDays.length} day{agendaDays.length === 1 ? "" : "s"} open
              </span>
            </div>
            <div className="space-y-3">
              {agendaDays.map((d) => (
                <AgendaDay
                  key={d}
                  dayIso={d}
                  openings={visibleDays[d] ?? EMPTY}
                  venuesById={venuesById}
                  colourByVenue={colourByVenue}
                  onPickOpening={onPickOpening}
                  showDate
                />
              ))}
            </div>
          </div>
        ) : (
          // The dock belongs here too: an empty month is either a filter that
          // doesn't apply to a pinned venue, or a quiet month it has a later
          // date for. Both are exactly when it's worth showing.
          <div>
            {pinnedDock}
            <div className="card card-pad text-center py-10">
              <CalendarDays
                className="w-8 h-8 mx-auto text-green-900/30"
                strokeWidth={1.5}
              />
              <p className="text-sm text-green-900/60 mt-3">
                {soleVenueName
                  ? `No tee times at ${soleVenueName} in ${format(month, "MMMM")}.`
                  : narrowed
                    ? `Nothing matches your filters in ${format(month, "MMMM")}.`
                    : `No tee times open in ${format(month, "MMMM")}.`}
              </p>
              {/* When filters are what emptied the month, clearing them is the
                  likelier fix than skipping forward. */}
              <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                {narrowed && (
                  <button
                    onClick={onClearVenueFilters ?? undefined}
                    className="btn btn-outline btn-sm"
                  >
                    Clear filters
                  </button>
                )}
                <button
                  onClick={() => onMonthChange(addMonths(month, 1))}
                  className="btn btn-outline btn-sm"
                >
                  {format(addMonths(month, 1), "MMMM")}
                  <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}

export default memo(VenueAvailabilityCalendar);
