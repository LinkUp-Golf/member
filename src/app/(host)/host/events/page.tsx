"use client";

// Host: create and manage hosted events. There is no draft — an event is live
// from the moment it's created, then: (event runs) → upload proof → pending
// approval → credits awarded. Cancelling frees any reserved spots, and an admin
// can take a listing down (which cancels it) if it shouldn't have gone out.

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useForm, Controller } from "react-hook-form";
import { AdminPageHeader, AdminCard } from "@/components/admin/AdminUI";
import { Spinner, ContentLoader } from "@/components/ui/Loading";
import Select, { type SelectOption } from "@/components/ui/Select";
import VenueDateSelector from "@/components/host/VenueDateSelector";
import { HOST_EVENT_GUEST_RATE_USD } from "@/lib/constants";
import { canUploadProof } from "@/lib/hosts/events";
import { formatEventTeeTime as fmtTime } from "@/lib/utils";
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
      name: e.course?.name ?? "Course",
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
  const canProof = canUploadProof(event.status, event.event_date);

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
          text: "Not visible to members yet — we're setting up the calendar.",
        }
      : event.status === "pending_credit_approval"
        ? { tone: "text-amber-600", text: "Proof sent — waiting on your credit." }
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
          {canProof && (
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

      {note && !cancelling && (
        <p className={`text-[11px] mt-2 ${note.tone}`}>{note.text}</p>
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

// ---- Proof upload -------------------------------------------

function ProofControl({
  event,
  onDone,
  onToast,
}: {
  event: HostedEvent;
  onDone: () => void;
  onToast: (msg: string, ok?: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      onToast("Use a JPG, PNG, or WebP image.", false);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onToast("Image must be under 10 MB.", false);
      return;
    }
    setUploading(true);
    const data = new FormData();
    data.append("file", file);
    const res = await fetch(`/api/host/events/${event.id}/proof`, {
      method: "POST",
      body: data,
    });
    const json = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) {
      onToast(json.error ?? "Upload failed.", false);
      return;
    }
    onToast("Proof submitted for approval.");
    onDone();
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="btn btn-gold btn-sm"
      >
        {uploading
          ? "Uploading…"
          : event.status === "pending_credit_approval"
            ? "Replace proof"
            : "Upload proof"}
      </button>
    </>
  );
}

// ---- Create / edit drawer -----------------------------------

interface EventFormValues {
  course_id: string;
  /** '' means "no fixed tee time". */
  tee_time: string;
  dinner: boolean;
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
        label: event.course?.name ?? "Current course",
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
      // Dates come from the picker rather than an RHF field, so the "at least
      // one" rule lives here. Duplicates aren't possible — the picker toggles.
      if (dates.length === 0) {
        setDateError("Choose at least one date from the venue's open days.");
        return;
      }
      setDateError(null);
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

            <div>
              <label htmlFor="ev-course" className={labelCls}>
                Course *
              </label>

              <Controller
                name="course_id"
                control={control}
                shouldUnregister
                rules={{ required: "Choose a course" }}
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
                    placeholder="Select a course…"
                    searchPlaceholder="Search courses…"
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

            <div>
              <label htmlFor="ev-time" className={labelCls}>
                Tee time
              </label>
              <input
                id="ev-time"
                type="text"
                className={field}
                placeholder="e.g. 8:30 AM (optional)"
                maxLength={50}
                {...register("tee_time")}
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Type the tee time however you like, or leave it blank if
                there&apos;s no fixed time.
              </p>
            </div>

          {/* The terms, stated rather than asked for. Every hosted round runs
              on the same ones, so this is information, not a field. */}
          <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-xs text-green-900">
            Each date is listed with the spots that venue has open that day — the
            number on each date above — at {fmtMoney(HOST_EVENT_GUEST_RATE_USD)}{" "}
            per round.
          </div>

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
        </form>

        {/* "Submit", not "Publish" — saving sends the event for approval, and
            the LinkUp team is what makes it live once the calendar exists. */}
        <div className="px-6 py-4 border-t border-gray-100 flex flex-col gap-2 flex-shrink-0">
          {!isEdit && (
            <p className="text-[11px] text-gray-500">
              We&apos;ll set up the calendar for this round, then publish it to
              members.
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
            ) : (
              "Submit for approval"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
