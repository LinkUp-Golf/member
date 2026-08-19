"use client";

// Host: create and manage hosted events. There is no draft — an event is live
// from the moment it's created, then: (event runs) → upload proof → pending
// approval → credits awarded. Cancelling frees any reserved spots, and an admin
// can take a listing down (which cancels it) if it shouldn't have gone out.

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useForm, Controller } from "react-hook-form";
import {
  AdminPageHeader,
  AdminCard,
  Badge,
  ProgressBar,
} from "@/components/admin/AdminUI";
import { Spinner, ContentLoader } from "@/components/ui/Loading";
import Select, { type SelectOption } from "@/components/ui/Select";
import VenueDateSelector from "@/components/host/VenueDateSelector";
import { HOST_EVENT_GUEST_RATE_USD } from "@/lib/constants";
import { memberPrice, canUploadProof } from "@/lib/hosts/events";
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

const STATUS_META: Record<
  HostedEventStatus,
  { label: string; colour: "green" | "gold" | "red" | "blue" | "gray" }
> = {
  pending_approval: { label: "Awaiting approval", colour: "gold" },
  upcoming: { label: "Upcoming", colour: "green" },
  completed: { label: "Completed", colour: "blue" },
  pending_credit_approval: { label: "Credit approval", colour: "gold" },
  credits_awarded: { label: "Credits awarded", colour: "green" },
  cancelled: { label: "Cancelled", colour: "red" },
};

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

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
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
          {events.map((e) => (
            <EventCard
              key={e.id}
              event={e}
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

// ---- Event card ---------------------------------------------

const EventCard = memo(function EventCard({
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
  const meta = STATUS_META[event.status];
  const filled = event.filled_spots ?? 0;
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

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">
              {event.course?.name ?? "Course"}
            </p>
            <Badge label={meta.label} colour={meta.colour} />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {fmtDate(event.event_date)}
            {event.tee_time ? ` · ${fmtTime(event.tee_time)}` : ""}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {fmtMoney(
              event.member_price ?? memberPrice(event.member_guest_rate),
            )}{" "}
            member
            <span className="text-gray-300"> · </span>
            {fmtMoney(event.member_guest_rate)} guest rate
          </p>
        </div>
        <Link
          href={`/host/events/${event.id}`}
          className="text-xs font-medium text-gray-500 hover:text-green-800 flex-shrink-0 whitespace-nowrap"
        >
          {filled} registered →
        </Link>
      </div>

      {/* Spots */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>
            {filled} of {event.total_spots} spots filled
          </span>
          <span>
            {event.remaining_spots ?? event.total_spots - filled} left
          </span>
        </div>
        <ProgressBar value={filled} max={event.total_spots} />
      </div>

      {event.dinner && (
        <p className="text-xs text-green-800 mt-3 font-medium">
          🍽 Dinner included
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-4">
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
        {editable && (
          <CancelButton
            event={event}
            busy={busy}
            onCancelReason={(reason) =>
              act("cancel", { cancellation_reason: reason })
            }
          />
        )}
      </div>

      {/* The host needs to know members can't see this yet, and why — otherwise
          an empty spots bar reads as "nobody wants it" rather than "not live". */}
      {awaitingApproval && (
        <p className="text-[11px] text-amber-600 mt-3">
          Not visible to members yet — we&apos;re setting up the calendar for
          this round. You&apos;ll get a notification when it goes live.
        </p>
      )}
      {event.status === "pending_credit_approval" && (
        <p className="text-[11px] text-amber-600 mt-3">
          Proof submitted — awaiting admin approval for your credit.
        </p>
      )}
      {/* An admin took this live event down. rejection_reason is what separates
          that from the host cancelling it themselves — say which it was. */}
      {event.status === "cancelled" && event.rejection_reason && (
        <p className="text-[11px] text-red-600 mt-3">
          Taken down by an admin: {event.rejection_reason}
        </p>
      )}
      {event.source_booking_id && (
        <p className="text-[11px] text-gray-400 mt-2">
          Listed from an existing booking — course, date, and tee time are
          fixed.
        </p>
      )}
      {event.status === "cancelled" && event.cancellation_reason && (
        <p className="text-[11px] text-gray-400 mt-3">
          Reason: {event.cancellation_reason}
        </p>
      )}
    </div>
  );
});

// ---- Cancel with optional reason ----------------------------

function CancelButton({
  event,
  onCancelReason,
  busy,
}: {
  event: HostedEvent;
  onCancelReason: (reason: string) => void;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const hasRegs = (event.filled_spots ?? 0) > 0;

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="btn btn-outline btn-sm text-red-600 border-red-200"
      >
        Cancel
      </button>
    );
  }
  return (
    <div className="w-full mt-1 p-3 rounded-xl bg-red-50 border border-red-100 space-y-2">
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
          onClick={() => setConfirming(false)}
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
