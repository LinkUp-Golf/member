"use client";

// Host: create hosted events and watch them run. There is no draft and, at a
// venue already on LinkUp, no queue: the round is live from the moment it's
// created, then (event runs) → upload proof → pending approval → credits
// awarded. An admin can take a listing down (which cancels it) if it shouldn't
// have gone out. A round at a club we don't have yet is the one exception — it
// waits while someone sets the club up.
//
// A host can't change or cancel a listed round from here for now: members
// reserve against a date and a tee time, and a round that moves or disappears
// under them is a promise broken by the app rather than by anyone. Changes go
// through an admin instead. The API still accepts both — see the note on
// EventDrawer — so the buttons can come back without a server change.

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import Image from "next/image";
import { useForm, Controller } from "react-hook-form";
import { AdminPageHeader, AdminCard } from "@/components/admin/AdminUI";
import { Spinner, ContentLoader } from "@/components/ui/Loading";
import Select, { type SelectOption } from "@/components/ui/Select";
import VenueDateSelector from "@/components/host/VenueDateSelector";
import NewLinkupFields from "@/components/host/NewLinkupFields";
import DateTeeTimeList from "@/components/host/DateTeeTimeList";
import ProofControl, {
  PROOF_NOTE_CLASS,
  currentProof,
  eventProofState,
} from "@/components/host/ProofControl";
import RoundPlayersSheet, {
  type RoundPlayers,
} from "@/components/host/RoundPlayersSheet";
import { HOST_EVENT_GUEST_RATE_USD } from "@/lib/constants";
import { formatEventTeeTime as fmtTime, cn } from "@/lib/utils";
import {
  emptyNewLinkup,
  hasNewLinkupErrors,
  newLinkupRounds,
  validateNewLinkup,
  type NewLinkupErrors,
  type NewLinkupValues,
} from "@/lib/hosts/new-linkup";
import {
  DEFAULT_TEE_TIME,
  missingTeeTimes,
  normaliseTeeTime,
} from "@/lib/hosts/tee-time";
import type {
  EventPlayer,
  HostedEvent,
  HostedEventStatus,
  Course,
} from "@/types";

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// Mirrors the server's MAX_EVENT_DATES — the picker holds the whole set now,
// rather than one field plus a list of extras.
const MAX_DATES_PER_EVENT = 30;

/** The chip an event still with us wears — on the card header, not the rows. */
const AWAITING_REVIEW = {
  label: "Waiting on us",
  dot: "bg-amber-500",
  text: "text-amber-700",
} as const;

// A dot and a word. A pill per row turned a list of dates into a wall of
// badges; the state matters, but not that much of the row's weight.
//
// Partial, and 'upcoming' is deliberately absent: a published round says nothing
// beside its date. "Live" was a label on the ordinary case — the date, the tee
// time and the spot count already say the round is up — and a word on every row
// made the states a host actually has to read harder to pick out. A status with
// no entry here gets no chip.
const STATUS_META: Partial<
  Record<HostedEventStatus, { label: string; dot: string; text: string }>
> = {
  pending_approval: AWAITING_REVIEW,
  completed: { label: "Finished", dot: "bg-blue-500", text: "text-blue-700" },
  pending_credit_approval: { label: "Credit pending", dot: "bg-amber-500", text: "text-amber-700" },
  credits_awarded: { label: "Credit paid", dot: "bg-green-600", text: "text-green-700" },
  cancelled: { label: "Cancelled", dot: "bg-red-500", text: "text-red-600" },
};

// The sentence that used to follow the chip — "We'll notify you once it's done."
// — is gone. Rounds at a venue already on LinkUp don't wait on anything now, so
// the only events wearing this are rounds at a club we haven't set up yet, where
// the chip alone is the fact and a promise about notifications was both noise and
// one more thing to keep true.

/** One venue's rounds. A host listing several dates at a club sees one card. */
interface VenueGroup {
  courseId: string;
  name: string;
  city: string | null;
  events: HostedEvent[];
}

function groupByVenue(events: HostedEvent[]): VenueGroup[] {
  const byCourse = new Map<string, VenueGroup>();
  for (const e of events) {
    const group = byCourse.get(e.course_id) ?? {
      courseId: e.course_id,
      name: e.course?.name ?? "Event",
      city: e.course?.city ?? null,
      events: [],
    };
    group.events.push(e);
    byCourse.set(e.course_id, group);
  }
  // Soonest first inside a card; the API already orders the events themselves.
  for (const g of byCourse.values()) {
    g.events.sort((a, b) => a.event_date.localeCompare(b.event_date));
  }
  return Array.from(byCourse.values());
}

export default function HostEventsPage() {
  const [events, setEvents] = useState<HostedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  // Creating only. Editing a listed round is switched off for now, so there is
  // no event to carry here — see the note on EventDrawer's `event` prop.
  const [creating, setCreating] = useState(false);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/host/events");
    const json = await res.json().catch(() => ({}));
    if (res.ok) setEvents(Array.isArray(json.events) ? json.events : []);
    else showToast(json.error ?? "Could not load events.", false);
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // One stable callback, so the memoized cards don't re-render whenever this
  // page does.
  const handleNew = useCallback(() => setCreating(true), []);

  const groups = useMemo(() => groupByVenue(events), [events]);

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <AdminPageHeader
        title="My Events"
        description="Create rounds members can reserve, then earn credits once they run."
        action={
          <button onClick={handleNew} className="btn btn-gold btn-sm">
            New event
          </button>
        }
      />

      {loading ? (
        <ContentLoader />
      ) : events.length === 0 ? (
        <AdminCard>
          <div className="py-10 text-center">
            <p className="text-sm text-gray-500">
              You haven&apos;t created any events yet.
            </p>
            <button onClick={handleNew} className="btn btn-gold btn-sm mt-4">
              Create your first event
            </button>
          </div>
        </AdminCard>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <VenueCard
              key={g.courseId}
              group={g}
              onChanged={load}
              onToast={showToast}
            />
          ))}
        </div>
      )}

      {creating && (
        <EventDrawer
          event={null}
          onClose={() => setCreating(false)}
          onSaved={(msg) => {
            setCreating(false);
            showToast(msg);
            load();
          }}
          onError={(msg) => showToast(msg, false)}
        />
      )}

      {toast && (
        <div
          className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? "bg-green-900 text-white" : "bg-red-600 text-white"}`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ---- Venue card ---------------------------------------------

const VenueCard = memo(function VenueCard({
  group,
  onChanged,
  onToast,
}: {
  group: VenueGroup;
  onChanged: () => void;
  onToast: (msg: string, ok?: boolean) => void;
}) {
  // Any date still with us means the event is. A host who lists a week of
  // dates submits them together, so this is nearly always all of them.
  const awaitingReview = group.events.some(
    (e) => e.status === "pending_approval",
  );

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-gray-100">
        <div className="min-w-0">
          {/* Title and, when the event is still with us, what's happening to
              it — the same dotted chip the date rows use for every other state,
              so one event reads like the rest of the list. Three words, because
              that is the whole of what we can honestly say: the club isn't set
              up yet. */}
          <h2 className="text-sm font-semibold text-gray-900">
            <span className="align-middle">{group.name}</span>
            {awaitingReview && (
              <span
                className={`ml-2 inline-flex items-center gap-1.5 align-middle text-xs font-normal ${AWAITING_REVIEW.text}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${AWAITING_REVIEW.dot}`}
                />
                {AWAITING_REVIEW.label}
              </span>
            )}
          </h2>
          {group.city && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{group.city}</p>
          )}
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
          {group.events.length}{" "}
          {group.events.length === 1 ? "date" : "dates"}
        </span>
      </header>

      <ul className="divide-y divide-gray-100">
        {group.events.map((e) => (
          <EventRow key={e.id} event={e} onChanged={onChanged} onToast={onToast} />
        ))}
      </ul>
    </section>
  );
});

// ---- Who's coming ------------------------------------------

/** How many faces before the rest become a "+n". */
const MAX_FACES = 4;

/**
 * The people on one round, as a row of overlapping faces.
 *
 * Ringed in white so an overlapping stack still reads as separate people, and
 * titled with the full name so a host can hover one on a desktop. Hidden from
 * screen readers, which can make nothing of four cropped photos — the button
 * around it carries the count, and opens the names for everyone.
 *
 * Unoptimized images on purpose: a member's avatar can be hosted wherever their
 * profile put it, and next/image throws outright on a hostname that isn't in
 * next.config's remotePatterns — taking the row down over one face.
 */
function PlayerFaces({ players }: { players: EventPlayer[] }) {
  // With one over the limit, showing MAX_FACES and "+1" costs the same room as
  // showing them all, so the cut only happens when it actually saves space.
  const shown =
    players.length > MAX_FACES ? players.slice(0, MAX_FACES - 1) : players;
  const more = players.length - shown.length;
  const name = (p: EventPlayer) =>
    `${p.first_name} ${p.last_name}`.trim() || "Member";

  return (
    // Labelled on the button that wraps it, so the faces themselves are
    // decoration as far as a screen reader is concerned.
    <span aria-hidden className="flex -space-x-1.5 flex-shrink-0">
      {shown.map((p) =>
        p.avatar_url ? (
          <Image
            key={p.member_id}
            src={p.avatar_url}
            alt=""
            title={name(p)}
            width={24}
            height={24}
            unoptimized
            className="w-6 h-6 rounded-full object-cover ring-2 ring-white bg-green-100"
          />
        ) : (
          <span
            key={p.member_id}
            title={name(p)}
            className="w-6 h-6 rounded-full ring-2 ring-white bg-green-900 text-white flex items-center justify-center text-[10px] font-bold uppercase leading-none"
          >
            {p.first_name.charAt(0) || "?"}
          </span>
        ),
      )}
      {more > 0 && (
        <span className="w-6 h-6 rounded-full ring-2 ring-white bg-green-100 text-green-900 flex items-center justify-center text-[10px] font-bold leading-none tabular-nums">
          +{more}
        </span>
      )}
    </span>
  );
}

// ---- One date -----------------------------------------------

const EventRow = memo(function EventRow({
  event,
  onChanged,
  onToast,
}: {
  event: HostedEvent;
  onChanged: () => void;
  onToast: (msg: string, ok?: boolean) => void;
}) {
  const meta = STATUS_META[event.status];
  const awaitingApproval = event.status === "pending_approval";
  // Whether a proof is in, what the button should say, and what to tell them —
  // all from one place, because the status alone can't answer the first of those.
  const proof = eventProofState(event);
  const proofImage = currentProof(event);
  // Everyone at the round: reserved through the event, plus members who booked
  // the venue that day. The roster is the headcount as well as the faces — it
  // was filled_spots + booked_spots, which counts a member who did both twice,
  // so the number could say four while three faces were shown. filled_spots is
  // still what capacity is enforced against in SQL, which is why it isn't this.
  const players = event.players ?? [];
  const playing = players.length;
  // The roster the sheet is showing, or null when it's shut. Held per row rather
  // than on the page: only one is ever open, and the sheet portals to the body,
  // so there is nothing for the page to coordinate.
  const [openRoster, setOpenRoster] = useState<RoundPlayers | null>(null);

  // At most one line of explanation, and only where the state needs one — four
  // possible notes stacked under every row was most of the old card's height.
  //
  // Nothing for a round awaiting approval: the chip beside the date now says
  // it, and saying it twice on one row was the loudest thing on a screen where
  // the host has nothing to do about it.
  const note = proof.note
    ? { tone: PROOF_NOTE_CLASS[proof.note.tone], text: proof.note.text }
    : event.status === "cancelled" && event.rejection_reason
      ? { tone: "text-red-600", text: `Taken down: ${event.rejection_reason}` }
      : event.status === "cancelled" && event.cancellation_reason
        ? { tone: "text-gray-400", text: `Cancelled: ${event.cancellation_reason}` }
        : null;

  return (
    <li className="px-4 sm:px-5 py-3">
      {/* One line at every width: the date and its numbers read left, the faces
          and anything to do read right, vertically centred against them. It used
          to stack on a phone, from when the row carried Edit and Cancel too —
          with those gone there's room, and the faces belong beside the round
          rather than dropped underneath it. */}
      <div className="flex items-center gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900">
              {fmtDate(event.event_date)}
            </p>
            {/* Every state that has a chip, except the one the title already
                carries. A live round has none — see STATUS_META. */}
            {!awaitingApproval && meta && (
              <span className={`inline-flex items-center gap-1.5 text-xs ${meta.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                {meta.label}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {event.tee_time ? `${fmtTime(event.tee_time)} · ` : ""}
            {playing} of {event.total_spots} spots
            {event.dinner ? " · dinner" : ""}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 flex-wrap">
          {proof.canUpload && (
            <ProofControl event={event} onDone={onChanged} onToast={onToast} />
          )}
          {/* Who is coming, as faces, and the way into their names — the same
              gesture the member app's booking calendar uses. This used to be a
              count that opened a whole page to answer a question a row of
              circles answers in place. Nothing when the round is empty: the spot
              line above already says "0 of 4". */}
          {players.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setOpenRoster({
                  date: event.event_date,
                  venueName: event.course?.name ?? "This venue",
                  teeTime: event.tee_time,
                  players,
                })
              }
              aria-label={`Who's coming on ${fmtDate(event.event_date)} — ${playing} ${playing === 1 ? "member" : "members"}`}
              className="focus-ring rounded-full p-0.5 -m-0.5 hover:bg-gray-100"
            >
              <PlayerFaces players={players} />
            </button>
          )}
        </div>
      </div>

      <RoundPlayersSheet round={openRoster} onClose={() => setOpenRoster(null)} />

      {/* Either half can stand alone: a settled round has a photo worth seeing
          and nothing left to say, and a note can exist before any photo does. */}
      {(note || proofImage) && (
        <div className="flex items-center gap-2 mt-2">
          {/* The photo itself, small. A line of text saying proof was sent is
              easy to miss and impossible to check; the thumbnail is the actual
              indicator, and it opens the full image. */}
          {proofImage && (
            <a
              href={proofImage.image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0"
              aria-label="View the proof you submitted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={proofImage.image_url}
                alt=""
                className="w-8 h-8 rounded object-cover border border-gray-200"
              />
            </a>
          )}
          {note && <p className={`text-[11px] ${note.tone}`}>{note.text}</p>}
        </div>
      )}
    </li>
  );
});

// ---- Create / edit drawer -----------------------------------

/**
 * Which of the drawer's two tabs is open.
 *
 * 'existing' (Current LinkUps) lists rounds at a club already on LinkUp: pick
 * the venue, pick from the days it actually has open. 'new' (New LinkUp)
 * proposes a club we don't have — there is no calendar to ask, so the host
 * types what they want and an admin sets it up.
 */
type LinkupTab = "existing" | "new";

interface EventFormValues {
  course_id: string;
  dinner: boolean;
}

/**
 * A venue as the form needs it: enough to name it in the dropdown and to show
 * what it actually is once picked. Both sources — every bookable course, and a
 * scoped host's own venues — return this shape.
 */
type VenueDetail = Pick<Course, "id" | "name" | "city"> & {
  state?: string | null;
  address?: string | null;
  logo_url?: string | null;
  map_link?: string | null;
  booking_url?: string | null;
  cost_per_player?: number | null;
  description?: string | null;
  approval_status?: string;
};

function EventDrawer({
  event,
  onClose,
  onSaved,
  onError,
}: {
  /**
   * The round being edited, or null to create.
   *
   * Always null today: the Edit button that supplied one is gone while host
   * editing is switched off. Its `isEdit` path is kept rather than stripped
   * because it's the whole of what turning editing back on needs — the drawer,
   * the single-date picker and the PATCH it submits to are all still here and
   * still correct. Passing an event is the only missing piece.
   */
  event: HostedEvent | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const isEdit = !!event;
  const [courses, setCourses] = useState<VenueDetail[]>([]);
  // The host's approved venues, and whether they're scoped at all. `unrestricted`
  // is read from the server rather than inferred from the list being empty — an
  // empty list used to mean "offer every bookable course", so a failed load or an
  // empty grant silently widened what the host could pick.
  const [venues, setVenues] = useState<VenueDetail[]>([]);
  const [venuesUnrestricted, setVenuesUnrestricted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Every day being listed, chosen from what the venue actually has open.
  // Course, spots, rate and dinner are shared, so listing a week of rounds is
  // one form rather than five. Editing acts on a single existing event, so the
  // picker runs in single-select there.
  const [dates, setDates] = useState<string[]>(
    event?.event_date ? [event.event_date.slice(0, 10)] : [],
  );
  // The tee time for each of those dates — each becomes its own event, and two
  // days at a club rarely tee off at the same time. Every date needs one; an
  // event stored with a free-text time from before starts blank, since the time
  // input can't show it.
  const [teeTimes, setTeeTimes] = useState<Record<string, string>>(() =>
    event?.event_date
      ? { [event.event_date.slice(0, 10)]: normaliseTeeTime(event.tee_time) }
      : {},
  );
  const [dateError, setDateError] = useState<string | null>(null);
  // Dates whose tee time was left empty when the host tried to submit. Marked
  // on the list itself rather than said once above it, so a host with a week of
  // dates can see which row is the problem.
  const [missingTees, setMissingTees] = useState<string[]>([]);
  // Editing acts on an event that already exists at a club that already exists,
  // so the proposal tab has nothing to offer there. A new event opens on the
  // first tab, New LinkUp — an unselected tab on the left reads as broken.
  const [tab, setTab] = useState<LinkupTab>("new");
  const proposing = !isEdit && tab === "new";
  // The New LinkUp tab's own values — its dates and tee times included, since
  // they're picked from every day rather than from a venue's open ones. Kept
  // while the host flips between tabs.
  const [newLinkup, setNewLinkup] = useState<NewLinkupValues>(emptyNewLinkup);
  const [newErrors, setNewErrors] = useState<NewLinkupErrors>({});

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    defaultValues: {
      course_id: event?.course_id ?? "",
      dinner: event?.dinner ?? false,
    },
  });

  // The date picker asks this venue what it has open, so changing the venue
  // invalidates whatever was picked at the previous one.
  const courseId = watch("course_id");

  // A failed load leaves an empty dropdown with no explanation, so surface it
  // rather than swallowing the error.
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/courses").then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("courses")),
      ),
      fetch("/api/host/venues").then((r) =>
        r.ok ? r.json() : Promise.reject(new Error("venues")),
      ),
    ])
      .then(([coursesJson, venuesJson]) => {
        if (cancelled) return;
        setCourses(coursesJson.courses ?? []);
        const vs = venuesJson.venues ?? [];
        setVenues(vs);
        setVenuesUnrestricted(venuesJson.unrestricted === true);
        // Pre-populate the course for a brand-new event when the host has a
        // single venue — nothing to choose.
        if (!isEdit && vs.length === 1) {
          setValue("course_id", vs[0].id);
        }
      })
      .catch(() => {
        if (!cancelled)
          setLoadError("Could not load venues. Close and reopen to retry.");
      });

    return () => {
      cancelled = true;
    };
    // isEdit/setValue are stable for the drawer's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Select is memoized on its props, so these must be stable across renders —
  // rebuilding the arrays every keystroke would re-render the whole dropdown.
  // Only a host the server says is unrestricted gets every bookable course; a
  // scoped host sees exactly their venues, even if that list is empty.
  const courseChoices = venuesUnrestricted ? courses : venues;
  const courseOptions: SelectOption[] = useMemo(() => {
    const opts = courseChoices.map((c) => ({
      value: c.id,
      // A venue the host proposed is selectable but not yet set up, and the
      // label is the only place that distinction can show in a native select.
      label:
        (c.city ? `${c.name} — ${c.city}` : c.name) +
        (c.approval_status === "pending" ? " (pending)" : ""),
    }));
    // When editing an event whose course predates the host's venue list, keep
    // it selectable so the dropdown doesn't render blank.
    if (event?.course_id && !opts.some((o) => o.value === event.course_id)) {
      opts.unshift({
        value: event.course_id,
        label: event.course?.name ?? "Current event",
      });
    }
    return opts;
  }, [courseChoices, event?.course_id, event?.course?.name]);

  // The venue behind the current selection, for the detail panel below it.
  const selectedVenue = useMemo(
    () => courseChoices.find((c) => c.id === courseId) ?? null,
    [courseChoices, courseId],
  );

  const labelCls = "block text-xs font-medium text-gray-600 mb-1";
  const errCls = "text-xs text-red-500 mt-1";

  /**
   * A new set of picked dates. Tee times follow their dates; on the edit form
   * the one event moving to another day keeps the tee time it had.
   */
  const changeDates = (next: string[]) => {
    setTeeTimes((prev) => {
      if (isEdit) {
        // One event, one tee time, whichever day it lands on — kept through a
        // moment with no day picked, too.
        const kept =
          Object.values(prev)[0] ?? normaliseTeeTime(event?.tee_time);
        return next[0] ? { [next[0]]: kept } : prev;
      }
      // A date picked for the first time arrives on the default; one already
      // picked keeps whatever the host set it to, including a cleared field.
      return Object.fromEntries(
        next.map((d) => [d, prev[d] ?? DEFAULT_TEE_TIME]),
      );
    });
    setDates(next);
    setMissingTees((prev) => prev.filter((d) => next.includes(d)));
    if (next.length) setDateError(null);
  };

  /** Dates picked somewhere else (another tab, another venue) don't carry. */
  const clearDates = () => {
    setDates([]);
    setTeeTimes({});
    setMissingTees([]);
    setDateError(null);
  };

  const setTeeTime = (date: string, value: string) => {
    setTeeTimes((prev) => ({ ...prev, [date]: value }));
    // Stop marking a row the moment it has a time, rather than at the next
    // submit.
    if (value) setMissingTees((prev) => prev.filter((d) => d !== date));
  };

  const removeDate = (date: string) =>
    changeDates(dates.filter((d) => d !== date));

  /** date → "HH:MM", for every date being listed. */
  const teeTimesFor = (list: string[]) =>
    Object.fromEntries(list.map((d) => [d, normaliseTeeTime(teeTimes[d])]));

  /**
   * Proposing a venue we don't have, and the rounds the host wants there.
   *
   * Two steps, in order, because the second needs the first's id:
   *
   *   1. POST /api/courses/request creates the venue as a pending course and
   *      grants this host access to it.
   *   2. POST /api/host/events creates a real hosted_event per date against it,
   *      in pending_approval — the one case that still waits on a person, because
   *      the club it runs at doesn't exist yet.
   *
   * Doing it as events rather than a filed note is what ties the host to the
   * rounds: they're attached from the start, so approving the venue approves
   * rounds someone is already waiting on. Spots and rate come from the host here
   * because nothing else can supply them — there's no calendar to read capacity
   * from and no rate agreed with a club we haven't spoken to.
   *
   * If step 2 fails the venue request stands. That's the right way round: the
   * venue is the part that takes a person to action, and the host can list the
   * dates once it's live.
   */
  async function propose(values: NewLinkupValues) {
    const name = values.name.trim();

    const courseRes = await fetch("/api/courses/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        website: values.website.trim() || null,
        // Set here as well as on the rounds below, so the club is created on
        // the right terms even if the second call never lands.
        payment_options: values.paymentOptions,
      }),
    });
    const courseJson = await courseRes.json().catch(() => ({}));
    if (!courseRes.ok || !courseJson.course?.id) {
      onError(courseJson.error ?? "Could not request that venue.");
      return;
    }

    const eventsRes = await fetch("/api/host/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Spots and rate are the host's here, and the same on every date, so
      // they're read off the first round rather than sent per date.
      body: (() => {
        const rounds = newLinkupRounds(values);
        return JSON.stringify({
          course_id: courseJson.course.id,
          event_dates: rounds.map((r) => r.event_date),
          tee_times: Object.fromEntries(
            rounds.map((r) => [r.event_date, r.tee_time]),
          ),
          total_spots: rounds[0]?.total_spots,
          member_guest_rate: rounds[0]?.member_guest_rate,
          payment_options: values.paymentOptions,
        });
      })(),
    });
    const eventsJson = await eventsRes.json().catch(() => ({}));
    if (!eventsRes.ok) {
      onError(
        `${name} was requested, but the dates didn't save: ${
          eventsJson.error ?? "please try adding them again."
        }`,
      );
      return;
    }

    const created = Array.isArray(eventsJson.events)
      ? eventsJson.events.length
      : values.dates.length;
    onSaved(
      `${name} requested with ${created} date${created === 1 ? "" : "s"}. We'll set the venue up, then publish your rounds to members.`,
    );
  }

  async function save(values: EventFormValues) {
    // Every date being listed, all picked from the venue's own availability.
    const allDates = [...dates].sort();

    // Spots and rate are the server's to set — every hosted round runs on the
    // same terms, so they aren't in this body at all.
    const payload = {
      course_id: values.course_id,
      // PATCH takes a single date and its tee time; only create fans out, with
      // a tee time per date.
      ...(isEdit
        ? {
            event_date: allDates[0],
            tee_time: normaliseTeeTime(teeTimes[allDates[0] as string]),
          }
        : { event_dates: allDates, tee_times: teeTimesFor(allDates) }),
      dinner: values.dinner,
      // Payment options aren't sent. They're the venue's own setting, and a
      // venue already on LinkUp has one an admin chose — listing a round there
      // is not a reason to overwrite it. A New LinkUp is a different path
      // (propose), and sets itself up as pay-at-club.
    };

    const res =
      isEdit && event
        ? await fetch(`/api/host/events/${event.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", ...payload }),
          })
        : await fetch("/api/host/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      onError(json.error ?? "Could not save.");
      return;
    }
    // Say how many when it was more than one — the host chose several dates, so a
    // bare "Published" would leave them counting.
    //
    // Which of the two things happened is read off the rows the server created,
    // not guessed from which tab was open: the server decides whether a round can
    // go live (see POST /api/host/events), and a toast that disagreed with it
    // would be the host's only account of where their round went.
    const rows = Array.isArray(json.events) ? json.events : [];
    const created = rows.length || 1;
    const live = (rows[0]?.status ?? json.event?.status) !== "pending_approval";
    const subject = created > 1 ? `${created} events` : "Event";
    onSaved(
      isEdit
        ? "Event updated."
        : live
          ? `${subject} published — members can reserve ${created > 1 ? "them" : "it"} now.`
          : `${subject} submitted. We'll set the venue up, then publish ${created > 1 ? "them" : "it"} to members.`,
    );
  }

  const submit = () =>
    handleSubmit((v) => {
      // New LinkUp's fields aren't RHF's — they're the shared component's, and
      // checked by the shared rules.
      if (proposing) {
        const errs = validateNewLinkup(newLinkup);
        setNewErrors(errs);
        if (hasNewLinkupErrors(errs)) return;
        return propose(newLinkup);
      }
      // Dates come from a picker rather than an RHF field, so the "at least
      // one" rule lives here. Duplicates aren't possible — the picker toggles.
      if (dates.length === 0) {
        setDateError("Choose at least one date from the venue's open days.");
        return;
      }
      setDateError(null);
      // Every picked date has to say what time it tees off at.
      const missing = missingTeeTimes(dates, teeTimes);
      setMissingTees(missing);
      if (missing.length > 0) return;
      return save(v);
    })();

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">
            {isEdit ? "Edit event" : "New event"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <form
          className="flex-1 overflow-y-auto px-6 py-6 space-y-4"
          noValidate
          onSubmit={(e) => e.preventDefault()}
        >
          {loadError && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-700">
              {loadError}
            </div>
          )}

          {/* Two ways to put a round on, and they aren't variations of one
              form: listing at a club we have asks the club what days it's
              free, while proposing one we don't have can't ask anything and
              has to be typed. Tabs rather than a toggle inside the form,
              because the fields below barely overlap. */}
          {!isEdit && (
            <div
              className="flex rounded-xl bg-gray-100 p-1"
              role="tablist"
              aria-label="Event source"
            >
              {(
                [
                  ["new", "New LinkUp"],
                  ["existing", "Current LinkUps"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    setTab(key);
                    // The two tabs pick from different things — one from a
                    // venue's open days, one from the whole calendar — so a
                    // selection can't carry across.
                    clearDates();
                  }}
                  className={cn(
                    "flex-1 rounded-lg py-2 text-xs font-semibold transition-colors",
                    tab === key
                      ? "bg-white text-green-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

            {!proposing && (
            <div>
              <label htmlFor="ev-course" className={labelCls}>
                Event *
              </label>

              <Controller
                name="course_id"
                control={control}
                shouldUnregister
                rules={{ required: "Choose an event" }}
                render={({ field: f }) => (
                  <Select
                    id="ev-course"
                    options={courseOptions}
                    value={f.value}
                    onChange={(next) => {
                      f.onChange(next);
                      // Open days belong to a venue, so a change invalidates
                      // anything picked at the previous one rather than
                      // carrying dates that club may not have.
                      clearDates();
                    }}
                    placeholder="Select an event…"
                    searchPlaceholder="Search events…"
                  />
                )}
              />
              {errors.course_id && (
                <p className={errCls}>{errors.course_id.message}</p>
              )}

              {/* What the venue actually is, and what hosting it is worth. A
                  host choosing between clubs shouldn't have to leave the form
                  to remember which one is which, or what they'll earn. */}
              {selectedVenue && (
                <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-3">
                  <div className="flex items-start gap-3">
                    {selectedVenue.logo_url && (
                      <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-white">
                        <Image
                          src={selectedVenue.logo_url}
                          alt=""
                          fill
                          unoptimized
                          className="object-contain"
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {selectedVenue.name}
                      </p>
                      {(selectedVenue.city || selectedVenue.state) && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {[selectedVenue.city, selectedVenue.state]
                            .filter(Boolean)
                            .join(", ")}
                        </p>
                      )}
                      {selectedVenue.address && (
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {selectedVenue.address}
                        </p>
                      )}
                      {selectedVenue.cost_per_player != null && (
                        <p className="text-[11px] text-gray-500 mt-1">
                          Green fee ${selectedVenue.cost_per_player}/player
                        </p>
                      )}
                    </div>
                  </div>

                  {selectedVenue.description && (
                    <p className="text-xs text-gray-600 mt-2.5 leading-relaxed">
                      {selectedVenue.description}
                    </p>
                  )}

                  {(selectedVenue.map_link || selectedVenue.booking_url) && (
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {selectedVenue.map_link && (
                        <a
                          href={selectedVenue.map_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-green-800 hover:text-green-900"
                        >
                          Map
                        </a>
                      )}
                      {selectedVenue.booking_url && (
                        <a
                          href={selectedVenue.booking_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-green-800 hover:text-green-900"
                        >
                          Website
                        </a>
                      )}
                    </div>
                  )}

                  <p className="mt-2.5 pt-2.5 border-t border-gray-200 text-xs font-semibold text-green-900">
                    Hosting here earns you{" "}
                    {fmtMoney(HOST_EVENT_GUEST_RATE_USD)} in credits per round,
                    once the round is verified.
                  </p>
                </div>
              )}
            </div>
            )}

            {/* ---- New LinkUp ------------------------------------------
                A club we don't have has no calendar, so nothing here can be
                asked of it — no venue to pick, and no open days to offer. The
                host writes what they want to run and an admin sets the club up
                against it. The same fields the become-a-host application asks,
                from the same component. */}
            {proposing && (
              <NewLinkupFields
                value={newLinkup}
                onChange={(next) => {
                  setNewLinkup(next);
                  if (hasNewLinkupErrors(newErrors)) setNewErrors({});
                }}
                errors={newErrors}
                maxDates={MAX_DATES_PER_EVENT}
                idPrefix="ev-new"
              />
            )}

            {!proposing && (
            <div>
              <label className={labelCls}>
                {isEdit ? "Date *" : "Dates *"}
              </label>
              <VenueDateSelector
                courseId={courseId || null}
                value={dates}
                onChange={changeDates}
                single={isEdit}
                max={isEdit ? 1 : MAX_DATES_PER_EVENT}
                exceptEventId={event?.id}
                showPickedElsewhere={false}
              />
              {/* Every picked date with its own tee time, right under the
                  picker. The edit form is one event, so its date is changed
                  from the picker rather than removed here. */}
              <DateTeeTimeList
                dates={dates}
                teeTimes={teeTimes}
                onTeeTimeChange={setTeeTime}
                onRemove={isEdit ? undefined : removeDate}
                invalidDates={missingTees}
                idPrefix="ev-tee"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                {isEdit
                  ? "Only days this venue still has open can be chosen. Set the time the round tees off."
                  : "Only days this venue has open and doesn't already have a round on are shown; the number is spots left. Each date becomes its own event, with its own tee time."}
              </p>
              {dateError && <p className={errCls}>{dateError}</p>}
            </div>
            )}

          {/* The terms, stated rather than asked for. Every hosted round at a
              listed club runs on the same ones, so this is information, not a
              field. The rate named here is the host's own — what the round is
              listed at and what they earn back in credit. */}
          {!proposing && (
            <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-xs text-green-900 leading-relaxed">
              Each date is listed with the spots that venue has open that day —
              the number on each date above — at{" "}
              {fmtMoney(HOST_EVENT_GUEST_RATE_USD)} per round.
            </div>
          )}

          {!proposing && (
            <div>
              <span className={labelCls}>Dinner</span>
              <label
                htmlFor="ev-dinner"
                className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 cursor-pointer"
              >
                <input
                  id="ev-dinner"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-green-900 focus:ring-green-800"
                  {...register("dinner")}
                />
                <span className="text-sm text-gray-700">
                  Dinner is included with this event
                </span>
              </label>
            </div>
          )}

        </form>

        {/* What the button does depends on which tab is open, because the two
            genuinely do different things: a round at a venue we already have goes
            live as it's created, while a club we don't have has to be set up by a
            person first. The word says which. */}
        <div className="px-6 py-4 border-t border-gray-100 flex flex-col gap-2 flex-shrink-0">
          {!isEdit && (
            <p className="text-[11px] text-gray-500">
              {proposing
                ? "We'll add the rounds, set this venue up against the dates you've listed, then publish them to members."
                : "This goes live as soon as you publish it — members can reserve a spot straight away."}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={isSubmitting}
            className="btn btn-gold btn-full justify-center"
          >
            {isSubmitting ? (
              <Spinner className="w-4 h-4 text-green-900" />
            ) : isEdit ? (
              "Save changes"
            ) : proposing ? (
              "Request this LinkUp"
            ) : (
              "Publish event"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
