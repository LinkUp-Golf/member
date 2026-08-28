"use client";

// Host: create and manage hosted events. There is no draft — an event is live
// from the moment it's created, then: (event runs) → upload proof → pending
// approval → credits awarded. Cancelling frees any reserved spots, and an admin
// can take a listing down (which cancels it) if it shouldn't have gone out.

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useForm, Controller } from "react-hook-form";
import { AdminPageHeader, AdminCard } from "@/components/admin/AdminUI";
import { Spinner, ContentLoader } from "@/components/ui/Loading";
import Select, { type SelectOption } from "@/components/ui/Select";
import VenueDateSelector from "@/components/host/VenueDateSelector";
import DateMultiPicker from "@/components/host/DateMultiPicker";
import ProofControl, {
  PROOF_NOTE_CLASS,
  currentProof,
  eventProofState,
} from "@/components/host/ProofControl";
import { TutorialLink } from "@/components/tutorials/TutorialPlayer";
import {
  HOST_EVENT_GUEST_RATE_USD,
  HOST_MEMBER_PRICE_MARKUP_USD,
} from "@/lib/constants";
import { formatEventTeeTime as fmtTime, cn } from "@/lib/utils";
import type {
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

// A dot and a word. A pill per row turned a list of dates into a wall of
// badges; the state matters, but not that much of the row's weight.
const STATUS_META: Record<
  HostedEventStatus,
  { label: string; dot: string; text: string }
> = {
  pending_approval: { label: "Waiting on us", dot: "bg-amber-500", text: "text-amber-700" },
  upcoming: { label: "Live", dot: "bg-green-600", text: "text-green-700" },
  completed: { label: "Finished", dot: "bg-blue-500", text: "text-blue-700" },
  pending_credit_approval: { label: "Credit pending", dot: "bg-amber-500", text: "text-amber-700" },
  credits_awarded: { label: "Credit paid", dot: "bg-green-600", text: "text-green-700" },
  cancelled: { label: "Cancelled", dot: "bg-red-500", text: "text-red-600" },
};

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
  const [editing, setEditing] = useState<HostedEvent | "new" | null>(null);

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

  // One stable callback for every row, so the memoized cards don't re-render
  // whenever this page does.
  const handleEdit = useCallback((e: HostedEvent) => setEditing(e), []);
  const handleNew = useCallback(() => setEditing("new"), []);

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

      {/* Under the header, above the list: the answer to "how do I do this?"
          where the question gets asked. */}
      <div className="mb-4">
        <TutorialLink tutorial="hosting-event" label="Watch: how to create an event" />
      </div>

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
            {/* A first-time host has nothing else on this screen to learn from. */}
            <div className="mt-4 flex justify-center">
              <TutorialLink tutorial="hosting-event" label="Watch how it works first" />
            </div>
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
              onEdit={handleEdit}
            />
          ))}
        </div>
      )}

      {editing && (
        <EventDrawer
          event={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
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
  onEdit,
}: {
  group: VenueGroup;
  onChanged: () => void;
  onToast: (msg: string, ok?: boolean) => void;
  onEdit: (event: HostedEvent) => void;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-gray-100">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 truncate">
            {group.name}
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
          <EventRow
            key={e.id}
            event={e}
            onChanged={onChanged}
            onToast={onToast}
            onEdit={onEdit}
          />
        ))}
      </ul>
    </section>
  );
});

// ---- One date -----------------------------------------------

const EventRow = memo(function EventRow({
  event,
  onChanged,
  onToast,
  onEdit,
}: {
  event: HostedEvent;
  onChanged: () => void;
  onToast: (msg: string, ok?: boolean) => void;
  /** Takes the event so the parent can pass one stable callback for every row. */
  onEdit: (event: HostedEvent) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const meta = STATUS_META[event.status];
  const filled = event.filled_spots ?? 0;
  // Members who booked the venue that day are at this round too, so the host's
  // headcount is both. filled_spots alone is what the reservation RPC enforces
  // capacity against, which is why the two numbers aren't the same thing.
  const playing = filled + (event.booked_spots ?? 0);
  // Mirrors the server's editable/cancellable set — a host can still fix an
  // event that hasn't happened yet, including one still waiting on approval.
  const awaitingApproval = event.status === "pending_approval";
  const editable = event.status === "upcoming" || awaitingApproval;
  // Whether a proof is in, what the button should say, and what to tell them —
  // all from one place, because the status alone can't answer the first of those.
  const proof = eventProofState(event);
  const proofImage = currentProof(event);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/host/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onToast(json.error ?? "Action failed.", false);
      return;
    }
    onToast(action === "cancel" ? "Event cancelled." : "Saved.");
    onChanged();
  }

  // At most one line of explanation, and only where the state needs one — four
  // possible notes stacked under every row was most of the old card's height.
  const note =
    awaitingApproval
      ? {
          tone: "text-amber-600",
          // Deliberately vague about what's outstanding. It used to say we were
          // setting up the calendar, which stopped being true the moment the
          // venue was approved — and a host looking at a venue that's clearly
          // live reads that as the app being wrong.
          text: "Not visible to members yet — waiting on our review.",
        }
      : proof.note
        ? { tone: PROOF_NOTE_CLASS[proof.note.tone], text: proof.note.text }
        : event.status === "cancelled" && event.rejection_reason
          ? { tone: "text-red-600", text: `Taken down: ${event.rejection_reason}` }
          : event.status === "cancelled" && event.cancellation_reason
            ? { tone: "text-gray-400", text: `Cancelled: ${event.cancellation_reason}` }
            : null;

  return (
    <li className="px-4 sm:px-5 py-3">
      {/* Stacked on a phone, one line from sm up: the date and its numbers read
          left, the things you can do to it read right. */}
      <div className="sm:flex sm:items-center sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900">
              {fmtDate(event.event_date)}
            </p>
            <span className={`inline-flex items-center gap-1.5 text-xs ${meta.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {event.tee_time ? `${fmtTime(event.tee_time)} · ` : ""}
            {playing} of {event.total_spots} spots
            {event.dinner ? " · dinner" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-2 sm:mt-0 sm:flex-shrink-0">
          {editable && (
            <button
              onClick={() => onEdit(event)}
              disabled={busy}
              className="btn btn-outline btn-sm"
            >
              Edit
            </button>
          )}
          {proof.canUpload && (
            <ProofControl event={event} onDone={onChanged} onToast={onToast} />
          )}
          {editable && !cancelling && (
            <button
              onClick={() => setCancelling(true)}
              disabled={busy}
              className="btn btn-outline btn-sm text-red-600 border-red-200"
            >
              Cancel
            </button>
          )}
          {/* The registered count is the link — it is the reason to open the
              round, so it does not need a separate arrow next to it. */}
          <Link
            href={`/host/events/${event.id}`}
            className="text-xs font-medium text-gray-500 hover:text-green-800 whitespace-nowrap ml-auto sm:ml-0"
          >
            {playing} {playing === 1 ? "member" : "members"} →
          </Link>
        </div>
      </div>

      {/* Either half can stand alone: a settled round has a photo worth seeing
          and nothing left to say, and a note can exist before any photo does. */}
      {(note || proofImage) && !cancelling && (
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

      {/* Under the row rather than in the button column, so the reason field
          gets the full width on a phone. */}
      {cancelling && (
        <CancelPanel
          event={event}
          busy={busy}
          onDismiss={() => setCancelling(false)}
          onCancelReason={(reason) => {
            setCancelling(false);
            act("cancel", { cancellation_reason: reason });
          }}
        />
      )}
    </li>
  );
});

// ---- Cancel with optional reason ----------------------------

function CancelPanel({
  event,
  onCancelReason,
  onDismiss,
  busy,
}: {
  event: HostedEvent;
  onCancelReason: (reason: string) => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const hasRegs = (event.filled_spots ?? 0) > 0;

  return (
    <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-100 space-y-2">
      <p className="text-xs text-red-700">
        Cancel this event
        {hasRegs
          ? ` and release all ${event.filled_spots} reserved spot${event.filled_spots === 1 ? "" : "s"}`
          : ""}
        ?
      </p>
      <input
        className="input text-sm"
        placeholder="Reason (optional, shown to members)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          onClick={onDismiss}
          disabled={busy}
          className="btn btn-outline btn-sm flex-1"
        >
          Keep it
        </button>
        <button
          onClick={() => onCancelReason(reason.trim())}
          disabled={busy}
          className="btn btn-sm flex-1 bg-red-600 text-white"
        >
          Cancel event
        </button>
      </div>
    </div>
  );
}

// ---- Create / edit drawer -----------------------------------

/**
 * Which of the drawer's two tabs is open.
 *
 * 'existing' lists rounds at a club already on LinkUp: pick the venue, pick from
 * the days it actually has open. 'new' proposes a club we don't have — there is
 * no calendar to ask, so the host types what they want and an admin sets it up.
 */
type LinkupTab = "existing" | "new";

interface EventFormValues {
  course_id: string;
  /** '' means "no fixed tee time". */
  tee_time: string;
  dinner: boolean;
  // ---- New LinkUp only ----
  /** The club being proposed. */
  new_event_name: string;
  /** Optional — the one field on this tab that is. */
  new_website: string;
  new_slots_per_day: string;
  new_member_guest_rate: string;
}

const NO_TEE_TIME = "";

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
  // Everything else (course, tee time, spots, rate, dinner) is shared, so
  // listing a week of rounds is one form rather than five. Editing acts on a
  // single existing event, so the picker runs in single-select there.
  const [dates, setDates] = useState<string[]>(
    event?.event_date ? [event.event_date.slice(0, 10)] : [],
  );
  const [dateError, setDateError] = useState<string | null>(null);
  // Editing acts on an event that already exists at a club that already exists,
  // so the proposal tab has nothing to offer there.
  const [tab, setTab] = useState<LinkupTab>("existing");
  const proposing = !isEdit && tab === "new";

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
      tee_time: event?.tee_time ?? NO_TEE_TIME,
      dinner: event?.dinner ?? false,
      new_event_name: "",
      new_website: "",
      new_slots_per_day: "",
      new_member_guest_rate: "",
    },
  });

  // The date picker asks this venue what it has open, so changing the venue
  // invalidates whatever was picked at the previous one.
  const courseId = watch("course_id");

  // Read back so the markup notice can name the member price against the rate
  // the host is typing, rather than leaving them to add ten in their head.
  const rawNewRate = watch("new_member_guest_rate");
  const newRateNumber =
    rawNewRate?.trim() && Number.isFinite(Number(rawNewRate))
      ? Number(rawNewRate)
      : null;

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
        if (!isEdit && vs.length === 1) setValue("course_id", vs[0].id);
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

  const field = "input text-sm";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";
  const errCls = "text-xs text-red-500 mt-1";

  /**
   * Proposing a venue we don't have, and the rounds the host wants there.
   *
   * Two steps, in order, because the second needs the first's id:
   *
   *   1. POST /api/courses/request creates the venue as a pending course and
   *      grants this host access to it.
   *   2. POST /api/host/events creates a real hosted_event per date against it,
   *      in pending_approval — the same queue any other new round lands in.
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
  async function propose(values: EventFormValues) {
    const name = values.new_event_name.trim();

    const courseRes = await fetch("/api/courses/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        website: values.new_website.trim() || null,
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
      body: JSON.stringify({
        course_id: courseJson.course.id,
        event_dates: [...dates].sort(),
        total_spots: Number(values.new_slots_per_day),
        member_guest_rate: Number(values.new_member_guest_rate),
      }),
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
      : dates.length;
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
      // PATCH takes a single date; only create fans out.
      ...(isEdit ? { event_date: allDates[0] } : { event_dates: allDates }),
      tee_time: values.tee_time || null,
      dinner: values.dinner,
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
    // Say how many were submitted when it was more than one — the host chose
    // several dates, so a bare "Submitted" would leave them counting.
    const created = Array.isArray(json.events) ? json.events.length : 1;
    const submitted =
      created > 1 ? `${created} events submitted` : "Event submitted";
    onSaved(
      isEdit
        ? "Event updated."
        : `${submitted} for approval. We'll set up the calendar, then publish it to members.`,
    );
  }

  const submit = () =>
    handleSubmit((v) => {
      // Dates come from a picker rather than an RHF field on both tabs, so the
      // "at least one" rule lives here either way. Duplicates aren't possible —
      // both pickers toggle.
      if (dates.length === 0) {
        setDateError(
          proposing
            ? "Pick the dates you want to host."
            : "Choose at least one date from the venue's open days.",
        );
        return;
      }
      setDateError(null);
      return proposing ? propose(v) : save(v);
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
                  ["existing", "LinkUps"],
                  ["new", "New LinkUp"],
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
                    setDates([]);
                    setDateError(null);
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
                      setDates([]);
                      setDateError(null);
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
                against it. Everything but the website is required: this is the
                whole of what we'll have to work from. */}
            {proposing && (
              <>
                <div>
                  <label htmlFor="ev-new-name" className={labelCls}>
                    Event *
                  </label>
                  <input
                    id="ev-new-name"
                    type="text"
                    className={field}
                    placeholder="Name of the event you want to host"
                    maxLength={120}
                    {...register("new_event_name", {
                      validate: (v) =>
                        !proposing ||
                        v.trim().length >= 2 ||
                        "Enter the event name",
                    })}
                  />
                  {errors.new_event_name && (
                    <p className={errCls}>{errors.new_event_name.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="ev-new-website" className={labelCls}>
                    Website
                  </label>
                  <input
                    id="ev-new-website"
                    type="url"
                    className={field}
                    placeholder="https://… (optional)"
                    maxLength={200}
                    {...register("new_website", {
                      validate: (v) =>
                        !proposing ||
                        !v.trim() ||
                        /^https?:\/\/.+/i.test(v.trim()) ||
                        "Website must start with https://",
                    })}
                  />
                  {errors.new_website && (
                    <p className={errCls}>{errors.new_website.message}</p>
                  )}
                  <p className="text-[11px] text-gray-400 mt-1">
                    Optional, but it saves us looking the event up ourselves.
                  </p>
                </div>

                <div>
                  {/* A span, not a label: the control is a grid of day buttons,
                      so there is nothing for a label to point at. */}
                  <span className={labelCls}>Dates *</span>
                  {/* Real dates, not a description of them — that's what lets
                      each one become an event with this host's name on it,
                      rather than a note someone has to read and retype. Every
                      upcoming day is offered: there's no calendar to ask what
                      this venue has open until we've set it up. */}
                  <DateMultiPicker
                    value={dates}
                    onChange={(next) => {
                      setDates(next);
                      if (next.length) setDateError(null);
                    }}
                    max={MAX_DATES_PER_EVENT}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    Each date becomes its own event. We&apos;ll confirm them with
                    the venue while we set it up.
                  </p>
                  {dateError && <p className={errCls}>{dateError}</p>}
                </div>

                <div>
                  <label htmlFor="ev-new-slots" className={labelCls}>
                    Slots per day *
                  </label>
                  <input
                    id="ev-new-slots"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={200}
                    className={field}
                    placeholder="e.g. 12"
                    {...register("new_slots_per_day", {
                      validate: (v) => {
                        if (!proposing) return true;
                        const n = Number(v);
                        return (
                          (Number.isInteger(n) && n >= 1 && n <= 200) ||
                          "A whole number between 1 and 200"
                        );
                      },
                    })}
                  />
                  {errors.new_slots_per_day && (
                    <p className={errCls}>
                      {errors.new_slots_per_day.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="ev-new-rate" className={labelCls}>
                    Member guest rate *
                  </label>
                  <input
                    id="ev-new-rate"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className={field}
                    placeholder="e.g. 150"
                    {...register("new_member_guest_rate", {
                      validate: (v) => {
                        if (!proposing) return true;
                        const n = Number(v);
                        return (
                          (Number.isFinite(n) && n >= 0) || "0 or more"
                        );
                      },
                    })}
                  />
                  {errors.new_member_guest_rate && (
                    <p className={errCls}>
                      {errors.new_member_guest_rate.message}
                    </p>
                  )}
                </div>

                {/* The one term the host doesn't set, so it's stated rather
                    than asked for — and stated against the number they just
                    typed, since "we add $10" is easy to read past. */}
                <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-xs text-green-900 leading-relaxed">
                  We add {fmtMoney(HOST_MEMBER_PRICE_MARKUP_USD)} per member on
                  top of your guest rate.
                  {newRateNumber !== null && (
                    <>
                      {" "}
                      At {fmtMoney(newRateNumber)}, members are listed at{" "}
                      <span className="font-semibold">
                        {fmtMoney(newRateNumber + HOST_MEMBER_PRICE_MARKUP_USD)}
                      </span>
                      .
                    </>
                  )}
                </div>
              </>
            )}

            {!proposing && (
            <div>
              <label className={labelCls}>
                {isEdit ? "Date *" : "Dates *"}
              </label>
              <VenueDateSelector
                courseId={courseId || null}
                value={dates}
                onChange={(next: string[]) => {
                  setDates(next);
                  if (next.length) setDateError(null);
                }}
                single={isEdit}
                max={isEdit ? 1 : MAX_DATES_PER_EVENT}
                exceptEventId={event?.id}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                {isEdit
                  ? "Only days this venue still has open can be chosen."
                  : "Only days this venue has open and doesn't already have a round on are shown; the number is spots left. Each date becomes its own event."}
              </p>
              {dateError && <p className={errCls}>{dateError}</p>}
            </div>
            )}

            {!proposing && (
            <div>
              <label htmlFor="ev-time" className={labelCls}>
                Tee time
              </label>
              <input
                id="ev-time"
                type="text"
                className={field}
                placeholder="e.g. 8:30 AM or morning/afternoon"
                maxLength={50}
                {...register("tee_time")}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Type the tee time however you like, or leave it blank if
                there&apos;s no fixed time.
              </p>
            </div>
            )}

          {/* The terms, stated rather than asked for. Every hosted round at a
              listed club runs on the same ones, so this is information, not a
              field — including the markup, which is the part a host is most
              likely to be surprised by later. */}
          {!proposing && (
            <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-xs text-green-900 leading-relaxed">
              Each date is listed with the spots that venue has open that day —
              the number on each date above — at{" "}
              {fmtMoney(HOST_EVENT_GUEST_RATE_USD)} per round. We add{" "}
              {fmtMoney(HOST_MEMBER_PRICE_MARKUP_USD)} per member on top, so
              members are listed at{" "}
              <span className="font-semibold">
                {fmtMoney(
                  HOST_EVENT_GUEST_RATE_USD + HOST_MEMBER_PRICE_MARKUP_USD,
                )}
              </span>
              .
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

        {/* "Submit", not "Publish" — saving sends the event for approval, and
            the LinkUp team is what makes it live once the calendar exists. */}
        <div className="px-6 py-4 border-t border-gray-100 flex flex-col gap-2 flex-shrink-0">
          {!isEdit && (
            <p className="text-[11px] text-gray-500">
              {proposing
                ? "We'll add the event, set up its calendar against the dates you've listed, then publish it to members."
                : "We'll set up the calendar for this round, then publish it to members."}
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
              "Submit for approval"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
