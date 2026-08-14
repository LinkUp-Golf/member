"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { Flag, Plus, X } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { apiClient } from "@/lib/api-client";
import { Spinner } from "@/components/ui/Loading";
import AppShell from "@/components/layout/AppShell";
import { formatRelativeTime } from "@/lib/utils";
import { NEW_VENUE_REF } from "@/lib/validation";
import type {
  Host,
  HostApplication,
  HostApplicationEventInput,
  Course,
} from "@/types";

type VenueOption = Pick<Course, "id" | "name" | "city"> & {
  /** 'pending' for a club the applicant proposed that an admin hasn't set up yet. */
  approval_status?: Course["approval_status"];
};

interface ApplicationState {
  application: HostApplication | null;
  host: Pick<Host, "id" | "name" | "status"> | null;
  venues?: VenueOption[];
}

export default function HostApplicationPage() {
  const { user } = useProfile();
  const [state, setState] = useState<ApplicationState>({
    application: null,
    host: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A failed status read is not the same as "you have never applied". Rendering
  // the apply form on a failed load showed a blank form to someone with a live
  // application, whose submit then 409'd with "you already have one under review".
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const res = await apiClient.get<ApplicationState>("/api/host/application");
    if (res.data) {
      setState(res.data);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Approval happens elsewhere (an admin, in their own session), so this page has
  // to re-read rather than wait to be told. Re-checking when the tab regains
  // focus is what turns "Under review" into the approved state without a manual
  // reload — the member otherwise sat on a stale card indefinitely.
  useEffect(() => {
    if (!user) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, load]);

  const { application, host } = state;
  const isPending = application?.status === "pending";
  const wasRejected = application?.status === "rejected";
  // The host row is the role — an admin can grant it without an application.
  // Suspended hosts are excluded: the workspace gates refuse them, so offering
  // the dashboard link would be a closed loop.
  const isHost = !!host && host.status === "active";

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div
              className="font-sans font-black text-2xl"
              style={{ color: "var(--color-gold)" }}
            >
              Become a Host
            </div>
            <div className="logo-subtitle">
              Run your own rounds and earn credits
            </div>
          </div>
        </div>
      }
    >
      <div className="px-5 py-5 pb-8">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Spinner className="w-5 h-5 text-green-900" />
          </div>
        ) : (
          <>
            {/* How it works */}
            <div className="card card-pad mb-5 space-y-3">
              <p className="section-label">How it works</p>
              <Step
                n={1}
                text="Tell us the private or semi-private golf club where you have a membership and would like to host LinkUps. You may select from the list below or add a new club not already on the list."
              />
              <Step
                n={2}
                text={`Type the dates, time, number of guests and cost per player. If you don't know the exact tee time, just enter "morning" or "afternoon". You may enter just one date or several.`}
              />
              <Step
                n={3}
                text="We will add those events to the LinkUp calendar."
              />
              <Step
                n={4}
                text="Members signup on the LinkUp calendar and pay LinkUp. We transfer the money and executive profile of each player to you prior to the event."
              />
              <Step
                n={5}
                text="For each event you submit proof of hosting with a group pic, you receive LinkUp credit of $150, which you can apply to either your membership or any LinkUp event."
              />
            </div>

            {/* Already a host */}
            {isHost && (
              <div className="card card-pad mb-5">
                <StatusPill label="Approved" tone="green" />
                <p className="text-sm text-green-900/70 leading-relaxed mt-3">
                  You&apos;re a host, operating as <strong>{host.name}</strong>.
                  Create events and track your credits from your dashboard.
                </p>

                {/* Which clubs the approval granted. Previously the only way to
                    find this out was to open the event form's course dropdown. */}
                {state.venues && state.venues.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {state.venues.map((v) => (
                      <p
                        key={v.id}
                        className="text-xs text-green-900/60 flex items-center gap-1.5"
                      >
                        <span className="w-1 h-1 rounded-full bg-green-900/40 flex-shrink-0" />
                        {v.city ? `${v.name} — ${v.city}` : v.name}
                        {v.approval_status === "pending" && (
                          <span className="text-yellow-700">(pending)</span>
                        )}
                      </p>
                    ))}
                  </div>
                )}

                <Link
                  href="/host"
                  className="btn btn-gold btn-full justify-center mt-4"
                >
                  Open host dashboard
                </Link>
              </div>
            )}

            {/* Under review */}
            {!isHost && isPending && (
              <div className="card card-pad mb-5">
                <StatusPill label="Under review" tone="yellow" />
                <p className="text-sm text-green-900/70 leading-relaxed mt-3">
                  Your application is with our team. We&apos;ll notify you as
                  soon as it&apos;s been reviewed.
                </p>
                {/* What they actually submitted. Previously the card said only
                    that something was under review, not what. */}
                {application.events && application.events.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {application.events.map((ev) => (
                      <p
                        key={ev.id}
                        className="text-xs text-green-900/60 flex items-center gap-1.5"
                      >
                        <span className="w-1 h-1 rounded-full bg-green-900/40 flex-shrink-0" />
                        {ev.course?.name ?? "Venue"} · {ev.event_date}
                        {ev.tee_time ? ` · ${ev.tee_time}` : ""} ·{" "}
                        {ev.total_spots} spots
                      </p>
                    ))}
                  </div>
                )}

                <p className="text-xs text-green-900/40 mt-2">
                  Submitted {formatRelativeTime(application.created_at)}
                </p>
              </div>
            )}

            {/* Rejected — may re-apply */}
            {!isHost && wasRejected && (
              <div className="card card-pad mb-5">
                <StatusPill label="Not approved" tone="red" />
                {application.rejection_reason && (
                  <p className="text-sm text-green-900/70 leading-relaxed mt-3">
                    {application.rejection_reason}
                  </p>
                )}
                <p className="text-xs text-green-900/40 mt-2">
                  Reviewed{" "}
                  {application.reviewed_at
                    ? formatRelativeTime(application.reviewed_at)
                    : "recently"}{" "}
                  · you&apos;re welcome to apply again below.
                </p>
              </div>
            )}

            {/* Status couldn't be read — say so rather than implying the member
                has never applied, which is what an unguarded apply form does. */}
            {loadFailed && !isHost && !isPending && (
              <div className="card card-pad mb-5">
                <StatusPill label="Unavailable" tone="yellow" />
                <p className="text-sm text-green-900/70 leading-relaxed mt-3">
                  We couldn&apos;t load your host status. Check your connection and
                  try again.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    load();
                  }}
                  className="btn btn-gold btn-full justify-center mt-4"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Apply — available when not a host and nothing is pending */}
            {!loadFailed && !isHost && !isPending && (
              <ApplicationForm
                heading={wasRejected ? "Apply again" : "Apply to become a host"}
                error={error}
                onSubmit={async ({ name, description, course_ids, events }) => {
                  setError(null);
                  const res = await apiClient.post("/api/host/application", {
                    name,
                    description,
                    course_ids,
                    events,
                  });
                  if (res.error) {
                    setError(res.error.message);
                    return false;
                  }
                  await load();
                  return true;
                }}
              />
            )}

            {!isHost && !isPending && !wasRejected && (
              <p className="text-xs text-green-900/35 text-center mt-5 flex items-center justify-center gap-1.5">
                <Flag className="w-3.5 h-3.5" strokeWidth={1.75} />
                Credits are awarded after each event, once an admin approves
                your proof.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

// ---- Application form ---------------------------------------

const NAME_MIN = 2;
const NAME_MAX = 120;
const DESC_MIN = 20;
const DESC_MAX = 1000;

type ApplicationValues = { name: string; description: string };

/** A round as submitted: `venue` is a course id or a `new:<index>` reference. */
type ProposedRound = Omit<HostApplicationEventInput, "course_id"> & {
  venue: string;
};

type SubmitValues = ApplicationValues & {
  course_ids: string[];
  new_venues: { name: string; website: string | null }[];
  events: ProposedRound[];
};

/**
 * A club the applicant named that isn't on LinkUp yet. Held in form state only —
 * the pending course is created when the application is submitted, so abandoning
 * the form leaves nothing behind in the admin queue.
 */
interface CustomVenueDraft {
  key: number;
  name: string;
  website: string;
}

/**
 * A round being filled in on the application. Strings rather than numbers because
 * these are raw inputs — an empty numeric field is "" and must stay
 * distinguishable from 0, which is a legitimate guest rate.
 *
 * `dates` is a list: one round entry with several dates becomes one event per
 * date, all sharing the venue, tee time, spots, rate and dinner. That's the
 * "one date or several" model, without retyping the details per date.
 *
 * `venue` is either a real course id or `draft:<key>` for a custom venue that has
 * no id yet. The draft references are rewritten to `new:<index>` at submit time.
 */
interface RoundDraft {
  key: number;
  venue: string;
  dates: string[];
  tee_time: string;
  total_spots: string;
  member_guest_rate: string;
  dinner: boolean;
}

const DEFAULT_SPOTS = "3";
const MAX_ROUNDS = 20;
const MAX_DATES_PER_ROUND = 30;
const MAX_CUSTOM_VENUES = 10;

/** Prefix for a round pointing at a not-yet-created venue, by draft key. */
const DRAFT_VENUE = "draft:";

const newRound = (
  key: number,
  venue = "",
  overrides: Partial<RoundDraft> = {},
): RoundDraft => ({
  key,
  venue,
  dates: [""],
  tee_time: "",
  total_spots: DEFAULT_SPOTS,
  member_guest_rate: "",
  dinner: false,
  ...overrides,
});

function ApplicationForm({
  heading,
  error,
  onSubmit,
}: {
  heading: string;
  /** Server-side error (e.g. "you already have an application under review"). */
  error: string | null;
  onSubmit: (values: SubmitValues) => Promise<boolean>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ApplicationValues>({
    defaultValues: { name: "", description: "" },
  });

  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [venueError, setVenueError] = useState<string | null>(null);
  const [venuesLoaded, setVenuesLoaded] = useState(false);
  const [rounds, setRounds] = useState<RoundDraft[]>([]);
  const [roundErrors, setRoundErrors] = useState<Record<number, string>>({});
  const [customVenues, setCustomVenues] = useState<CustomVenueDraft[]>([]);
  const roundKey = useRef(0);
  const venueKey = useRef(0);

  useEffect(() => {
    apiClient.get<{ courses: VenueOption[] }>("/api/courses").then((res) => {
      if (res.data?.courses) setVenues(res.data.courses);
      // Distinguish "still loading" from "there genuinely are none" — otherwise a
      // failed fetch leaves the applicant staring at a loading line forever with
      // no way to reach "Add new venue".
      setVenuesLoaded(true);
    });
  }, []);

  /**
   * A club the applicant named that isn't on LinkUp yet, plus the round they said
   * they'd run at it. Nothing is created here — the draft lives in form state and
   * becomes a pending course only when the application is submitted, so a form
   * that's abandoned halfway leaves no orphaned course behind.
   *
   * The round is seeded from the details they just typed, so nothing is asked for
   * twice, and it points at the draft by key until submit rewrites it.
   */
  const addCustomVenue = (
    venue: { name: string; website: string },
    round: Partial<RoundDraft>,
  ) => {
    const key = ++venueKey.current;
    setCustomVenues((prev) => [...prev, { key, ...venue }]);
    setRounds((prev) => [
      ...prev,
      newRound(++roundKey.current, `${DRAFT_VENUE}${key}`, round),
    ]);
    setVenueError(null);
  };

  const removeCustomVenue = (key: number) => {
    setCustomVenues((prev) => prev.filter((v) => v.key !== key));
    // Rounds at a removed venue go with it — leaving them pointing at nothing
    // would fail validation on a field the applicant can no longer see.
    setRounds((prev) => prev.filter((r) => r.venue !== `${DRAFT_VENUE}${key}`));
  };

  const toggleVenue = (id: string) => {
    setVenueIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((v) => v !== id)
        : [...prev, id];
      // Deselecting a venue orphans any round pointing at it — the server would
      // drop those rounds silently, so clear the field and make it visible.
      if (!next.includes(id)) {
        setRounds((rs) =>
          rs.map((r) => (r.venue === id ? { ...r, venue: "" } : r)),
        );
      }
      return next;
    });
  };

  // Everything a round may be held at: existing venues that are ticked, plus every
  // custom venue named on this form.
  const roundVenueOptions: { value: string; label: string; pending: boolean }[] = [
    ...venues
      .filter((v) => venueIds.includes(v.id))
      .map((v) => ({
        value: v.id,
        label: v.city ? `${v.name} — ${v.city}` : v.name,
        pending: v.approval_status === "pending",
      })),
    ...customVenues.map((v) => ({
      value: `${DRAFT_VENUE}${v.key}`,
      label: v.name,
      pending: true,
    })),
  ];

  const addRound = () =>
    setRounds((prev) =>
      prev.length >= MAX_ROUNDS
        ? prev
        : [
            ...prev,
            // Default to the only venue when there's no choice to make.
            newRound(
              ++roundKey.current,
              roundVenueOptions.length === 1
                ? (roundVenueOptions[0]?.value ?? "")
                : "",
            ),
          ],
    );

  const updateRound = (key: number, patch: Partial<RoundDraft>) =>
    setRounds((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  const removeRound = (key: number) =>
    setRounds((prev) => prev.filter((r) => r.key !== key));

  const todayISO = new Date().toISOString().slice(0, 10);

  /**
   * Validate the rounds up front rather than letting the server reject the whole
   * application over one field. Mirrors validateHostedEventPayload, which is what
   * these are checked against again on submit and on approval.
   */
  const validateRounds = (): ProposedRound[] | null => {
    const errs: Record<number, string> = {};
    const payload: ProposedRound[] = [];

    // Custom venues are sent as a list; a round at one references it by position.
    const draftIndex = new Map(
      customVenues.map((v, i) => [`${DRAFT_VENUE}${v.key}`, i]),
    );

    for (const r of rounds) {
      if (!r.venue) {
        errs[r.key] = "Choose which venue this round is at.";
        continue;
      }
      const dates = r.dates.map((d) => d.trim()).filter(Boolean);
      if (dates.length === 0) {
        errs[r.key] = "Choose a date.";
        continue;
      }
      if (dates.length !== r.dates.length) {
        errs[r.key] = "Fill in or remove the empty date.";
        continue;
      }
      if (new Set(dates).size !== dates.length) {
        errs[r.key] = "Each date can only be added once.";
        continue;
      }
      if (dates.some((d) => d < todayISO)) {
        errs[r.key] = "Date cannot be in the past.";
        continue;
      }
      const spots = Number(r.total_spots);
      if (!Number.isInteger(spots) || spots < 1 || spots > 200) {
        errs[r.key] = "Spots must be a whole number between 1 and 200.";
        continue;
      }
      const rate = Number(r.member_guest_rate);
      if (r.member_guest_rate === "" || !Number.isFinite(rate) || rate < 0) {
        errs[r.key] = "Enter the guest rate.";
        continue;
      }
      // A draft venue has no id yet, so it travels as its position in new_venues.
      const draftPos = draftIndex.get(r.venue);
      const venueRef =
        draftPos === undefined ? r.venue : `${NEW_VENUE_REF}${draftPos}`;

      // One event per date, sharing everything else on the round.
      for (const date of dates) {
        payload.push({
          venue: venueRef,
          event_date: date,
          tee_time: r.tee_time.trim() || null,
          total_spots: spots,
          member_guest_rate: rate,
          dinner: r.dinner,
        });
      }
    }

    setRoundErrors(errs);
    return Object.keys(errs).length > 0 ? null : payload;
  };

  const submit = handleSubmit(async (data) => {
    // A custom venue counts: it's a venue they want to host at, it just doesn't
    // exist yet.
    if (venueIds.length === 0 && customVenues.length === 0) {
      setVenueError("Choose at least one venue you want to host at.");
      return;
    }
    if (customVenues.some((v) => v.name.trim().length < 2)) {
      setVenueError("Give every new venue a name (at least 2 characters).");
      return;
    }
    setVenueError(null);

    const events = validateRounds();
    if (!events) return;

    const ok = await onSubmit({
      name: data.name.trim(),
      description: data.description.trim(),
      course_ids: venueIds,
      // Order matters: the `new:<index>` refs in `events` point into this list.
      new_venues: customVenues.map((v) => ({
        name: v.name.trim(),
        website: v.website.trim() || null,
      })),
      events,
    });
    if (ok) {
      reset();
      setVenueIds([]);
      setCustomVenues([]);
      setRounds([]);
      setRoundErrors({});
    }
  });

  return (
    <form onSubmit={submit} className="card card-pad space-y-4" noValidate>
      <p className="section-label">{heading}</p>

      <div>
        <label
          htmlFor="host-name"
          className="text-xs text-green-900/50 mb-1.5 block"
        >
          Host name
        </label>
        <input
          id="host-name"
          className="input"
          placeholder="The name you'll host under — your own or a brand"
          {...register("name", {
            required: "Enter a host name",
            maxLength: {
              value: NAME_MAX,
              message: `At most ${NAME_MAX} characters`,
            },
            validate: (v) =>
              v.trim().length >= NAME_MIN || `At least ${NAME_MIN} characters`,
          })}
        />
        {errors.name && (
          <p className="text-xs text-red-500 mt-1.5">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="host-description"
          className="text-xs text-green-900/50 mb-1.5 block"
        >
          Description
        </label>
        <textarea
          id="host-description"
          className="input resize-none"
          rows={5}
          maxLength={DESC_MAX}
          placeholder="Tell us about the events you'd run, how often, and who you'd bring together."
          {...register("description", {
            required: "Add a short description",
            maxLength: {
              value: DESC_MAX,
              message: `At most ${DESC_MAX} characters`,
            },
            validate: (v) =>
              v.trim().length >= DESC_MIN || `At least ${DESC_MIN} characters`,
          })}
        />
        {errors.description && (
          <p className="text-xs text-red-500 mt-1.5">
            {errors.description.message}
          </p>
        )}
      </div>

      <div>
        <span className="text-xs text-green-900/50 mb-1.5 block">
          Which venues do you want to host at?
        </span>

        <AddNewClub
          onAdded={addCustomVenue}
          disabled={customVenues.length >= MAX_CUSTOM_VENUES}
        />

        {/* Custom venues, still only in this form. They read as selected venues
            because that's what they are — the course row just doesn't exist until
            the application is submitted. */}
        {customVenues.length > 0 && (
          <div className="space-y-1.5 mb-1.5">
            {customVenues.map((v) => (
              <div
                key={v.key}
                className="flex items-center gap-3 rounded-xl border border-green-900/15 bg-green-50/40 px-3 py-2.5"
              >
                <span className="text-sm text-green-900/80 min-w-0 flex-1 truncate">
                  {v.name}
                </span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full text-yellow-700 bg-yellow-50">
                  New
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${v.name}`}
                  onClick={() => removeCustomVenue(v.key)}
                  className="text-green-900/40 hover:text-red-500 p-0.5"
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!venuesLoaded ? (
          <p className="text-xs text-green-900/35">Loading venues…</p>
        ) : (
          <div className="space-y-1.5">
            {venues.map((v) => (
              <label
                key={v.id}
                className="flex items-center gap-3 rounded-xl border border-green-900/10 px-3 py-2.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-green-900/30 text-green-900 focus:ring-green-800"
                  checked={venueIds.includes(v.id)}
                  onChange={() => toggleVenue(v.id)}
                />
                <span className="text-sm text-green-900/80">
                  {v.city ? `${v.name} — ${v.city}` : v.name}
                </span>
                {v.approval_status === "pending" && (
                  <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full text-yellow-700 bg-yellow-50">
                    Pending
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
        {venueError && (
          <p className="text-xs text-red-500 mt-1.5">{venueError}</p>
        )}
      </div>

      {/* Proposed rounds — step 2 of "How it works". Same fields as the host
          event form, because on approval each of these becomes one of those
          events. Optional: an applicant with no dates yet can still apply. */}
      <div>
        <span className="text-xs text-green-900/50 mb-1.5 block">
          Rounds you&apos;d like to run
        </span>

        {rounds.length > 0 && (
          <div className="space-y-2 mb-1.5">
            {rounds.map((r, i) => (
              <div
                key={r.key}
                className="rounded-xl border border-green-900/15 bg-green-50/40 px-3 py-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-green-900/60">
                    Round {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRound(r.key)}
                    aria-label={`Remove round ${i + 1}`}
                    className="text-green-900/40 hover:text-red-500 p-0.5"
                  >
                    <X className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>

                {/* Only offer venues on this form — ticked existing ones and
                    custom ones. A round anywhere else can't be granted. Hidden
                    when there's one venue, since it's pre-filled. */}
                {roundVenueOptions.length > 1 && (
                  <select
                    className="input"
                    value={r.venue}
                    onChange={(e) =>
                      updateRound(r.key, { venue: e.target.value })
                    }
                  >
                    <option value="">Which venue?</option>
                    {roundVenueOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                        {o.pending ? " (pending)" : ""}
                      </option>
                    ))}
                  </select>
                )}

                {/* One date per event. Adding dates here beats adding whole
                    rounds — the venue, time, spots and rate are already right. */}
                {r.dates.map((d, di) => (
                  <div key={di} className="flex items-center gap-2">
                    <input
                      type="date"
                      className="input"
                      min={todayISO}
                      value={d}
                      onChange={(e) =>
                        updateRound(r.key, {
                          dates: r.dates.map((v, vi) =>
                            vi === di ? e.target.value : v,
                          ),
                        })
                      }
                    />
                    {r.dates.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove date ${di + 1}`}
                        onClick={() =>
                          updateRound(r.key, {
                            dates: r.dates.filter((_, vi) => vi !== di),
                          })
                        }
                        className="text-green-900/40 hover:text-red-500 p-0.5"
                      >
                        <X className="h-4 w-4" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                ))}

                {r.dates.length < MAX_DATES_PER_ROUND && (
                  <button
                    type="button"
                    onClick={() =>
                      updateRound(r.key, { dates: [...r.dates, ""] })
                    }
                    className="text-xs font-medium text-green-800"
                  >
                    + Add another date
                  </button>
                )}

                <input
                  type="text"
                  className="input"
                  placeholder="e.g. 8:30 AM (optional)"
                  maxLength={50}
                  value={r.tee_time}
                  onChange={(e) =>
                    updateRound(r.key, { tee_time: e.target.value })
                  }
                />

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={200}
                    placeholder="Available spots"
                    value={r.total_spots}
                    onChange={(e) =>
                      updateRound(r.key, { total_spots: e.target.value })
                    }
                  />
                  <input
                    type="number"
                    className="input"
                    min={0}
                    step="1"
                    placeholder="Member guest rate"
                    value={r.member_guest_rate}
                    onChange={(e) =>
                      updateRound(r.key, { member_guest_rate: e.target.value })
                    }
                  />
                </div>

                <label className="flex items-center gap-3 text-sm text-green-900/80 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-green-900/30 text-green-900 focus:ring-green-800"
                    checked={r.dinner}
                    onChange={(e) =>
                      updateRound(r.key, { dinner: e.target.checked })
                    }
                  />
                  Dinner included
                </label>

                {roundErrors[r.key] && (
                  <p className="text-xs text-red-500">{roundErrors[r.key]}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {rounds.length < MAX_ROUNDS && (
          <button
            type="button"
            onClick={addRound}
            disabled={venueIds.length === 0}
            className="flex w-full items-center gap-2 rounded-xl border border-dashed border-green-900/25 px-3 py-2.5 text-sm text-green-900/70 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add a round
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn btn-gold btn-full justify-center"
      >
        {isSubmitting ? (
          <Spinner className="w-4 h-4 text-green-900" />
        ) : (
          "Submit application"
        )}
      </button>
    </form>
  );
}

// ---- Add a club not yet on LinkUp ---------------------------
// Collects the club and the round the applicant would run at it, and hands both
// back to the form. Nothing is sent anywhere: the club used to be filed as a
// pending course the moment it was named, which meant every abandoned form left a
// course behind in the admin queue for an application that never arrived. The
// course is created when the application is submitted instead.
//
// Club fields match the hosted-event form's, and the round fields match an
// existing venue's round, so the same club described from any of those places
// produces the same row.

function AddNewClub({
  onAdded,
  disabled,
}: {
  onAdded: (
    venue: { name: string; website: string },
    round: Partial<RoundDraft>,
  ) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [dates, setDates] = useState<string[]>([""]);
  const [teeTime, setTeeTime] = useState("");
  const [spots, setSpots] = useState(DEFAULT_SPOTS);
  const [rate, setRate] = useState("");
  const [dinner, setDinner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayISO = new Date().toISOString().slice(0, 10);

  const reset = () => {
    setName("");
    setWebsite("");
    setDates([""]);
    setTeeTime("");
    setSpots(DEFAULT_SPOTS);
    setRate("");
    setDinner(false);
  };

  const add = () => {
    const trimmed = name.trim();
    const site = website.trim();
    if (trimmed.length < 2) {
      setError("Enter the club name (at least 2 characters).");
      return;
    }
    if (site && !/^https?:\/\/.+/i.test(site)) {
      setError("Website must be a valid URL (https://…).");
      return;
    }

    const filled = dates.map((d) => d.trim()).filter(Boolean);
    if (filled.length === 0) {
      setError("Choose at least one date.");
      return;
    }
    if (filled.length !== dates.length) {
      setError("Fill in or remove the empty date.");
      return;
    }
    if (new Set(filled).size !== filled.length) {
      setError("Each date can only be added once.");
      return;
    }
    if (filled.some((d) => d < todayISO)) {
      setError("Date cannot be in the past.");
      return;
    }
    const spotsNum = Number(spots);
    if (!Number.isInteger(spotsNum) || spotsNum < 1 || spotsNum > 200) {
      setError("Spots must be a whole number between 1 and 200.");
      return;
    }
    const rateNum = Number(rate);
    if (rate === "" || !Number.isFinite(rateNum) || rateNum < 0) {
      setError("Enter the guest rate.");
      return;
    }

    setError(null);
    onAdded(
      { name: trimmed, website: site },
      {
        dates: filled,
        tee_time: teeTime,
        total_spots: spots,
        member_guest_rate: rate,
        dinner,
      },
    );
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-green-900/25 px-3 py-2.5 text-sm text-green-900/70 mb-1.5 disabled:opacity-40"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
        Add new venue
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-green-900/15 bg-green-50/40 px-3 py-3 mb-1.5 space-y-2">
      <label
        htmlFor="new-club-name"
        className="text-xs text-green-900/50 block"
      >
        Golf Club Name
      </label>
      <input
        id="new-club-name"
        className="input"
        placeholder="e.g. Torrey Pines Golf Course"
        value={name}
        maxLength={120}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
      <input
        id="new-club-website"
        className="input"
        placeholder="Website link — https://…"
        value={website}
        maxLength={200}
        onChange={(e) => setWebsite(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />

      {/* The round itself — same fields as an existing venue's round, so adding a
          club and saying when you'd play there is one step. */}
      <span className="text-xs text-green-900/50 block pt-1">
        Rounds you&apos;d run here
      </span>

      {dates.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="date"
            className="input"
            min={todayISO}
            value={d}
            onChange={(e) =>
              setDates((prev) =>
                prev.map((v, vi) => (vi === i ? e.target.value : v)),
              )
            }
          />
          {dates.length > 1 && (
            <button
              type="button"
              aria-label={`Remove date ${i + 1}`}
              onClick={() =>
                setDates((prev) => prev.filter((_, vi) => vi !== i))
              }
              className="text-green-900/40 hover:text-red-500 p-0.5"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>
      ))}

      {dates.length < MAX_DATES_PER_ROUND && (
        <button
          type="button"
          onClick={() => setDates((prev) => [...prev, ""])}
          className="text-xs font-medium text-green-800"
        >
          + Add another date
        </button>
      )}

      <input
        type="text"
        className="input"
        placeholder="e.g. 8:30 AM (optional)"
        maxLength={50}
        value={teeTime}
        onChange={(e) => setTeeTime(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          className="input"
          min={1}
          max={200}
          placeholder="Available spots"
          value={spots}
          onChange={(e) => setSpots(e.target.value)}
        />
        <input
          type="number"
          className="input"
          min={0}
          step="1"
          placeholder="Member guest rate"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-3 text-sm text-green-900/80 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-green-900/30 text-green-900 focus:ring-green-800"
          checked={dinner}
          onChange={(e) => setDinner(e.target.checked)}
        />
        Dinner included
      </label>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        {/* Adds the venue to this form only — no request is sent. The club is
            created when the application is submitted. */}
        <button
          type="button"
          onClick={add}
          className="btn btn-gold flex-1 justify-center text-sm"
        >
          Add venue
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            reset();
          }}
          className="text-sm text-green-900/60 px-3"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---- Sub-components -----------------------------------------

const PILL_TONES = {
  green: "text-green-800 bg-green-100",
  yellow: "text-yellow-700 bg-yellow-50",
  red: "text-red-500 bg-red-50",
} as const;

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: keyof typeof PILL_TONES;
}) {
  return (
    <span
      className={`text-xs font-medium px-2.5 py-1 rounded-full ${PILL_TONES[tone]}`}
    >
      {label}
    </span>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-6 h-6 rounded-full bg-green-900 text-gold text-xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
        {n}
      </div>
      <p className="text-sm text-green-900/70 leading-relaxed">{text}</p>
    </div>
  );
}
