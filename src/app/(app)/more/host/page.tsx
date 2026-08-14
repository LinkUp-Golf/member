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
                onSubmit={async ({ name, course_ids, new_venues, events }) => {
                  setError(null);
                  const res = await apiClient.post("/api/host/application", {
                    name,
                    course_ids,
                    // Clubs named on this form that aren't on LinkUp yet. Left
                    // out of this body, they never reached the server and an
                    // application for only a new venue failed as "choose a venue".
                    new_venues,
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

type ApplicationValues = { name: string };

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
 * The round a venue would host. Strings rather than numbers because these are
 * raw inputs — an empty numeric field is "" and must stay distinguishable from
 * 0, which is a legitimate guest rate.
 *
 * `dates` is a list: one round with several dates becomes one event per date,
 * all sharing the tee time, spots, rate and dinner. That's the "one date or
 * several" model, without retyping the details per date — and it's why a venue
 * needs only one round. Two rounds at the same club were always just two dates.
 */
interface VenueRound {
  dates: string[];
  tee_time: string;
  total_spots: string;
  member_guest_rate: string;
  dinner: boolean;
}

const DEFAULT_SPOTS = "3";
const MAX_DATES_PER_ROUND = 30;
const MAX_CUSTOM_VENUES = 10;

/** Prefix identifying a not-yet-created venue by draft key. */
const DRAFT_VENUE = "draft:";

const newRound = (overrides: Partial<VenueRound> = {}): VenueRound => ({
  dates: [""],
  tee_time: "",
  total_spots: DEFAULT_SPOTS,
  member_guest_rate: "",
  dinner: false,
  ...overrides,
});

/**
 * Has the applicant started filling this round in? Rounds stay optional — you
 * can name the clubs you want and supply dates later — so an untouched one is
 * skipped rather than failing validation. total_spots is excluded because it
 * carries a default nobody chose.
 */
const roundStarted = (r: VenueRound): boolean =>
  r.dates.some((d) => d.trim()) ||
  r.tee_time.trim() !== "" ||
  r.member_guest_rate.trim() !== "" ||
  r.dinner;

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
    defaultValues: { name: "" },
  });

  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [venueError, setVenueError] = useState<string | null>(null);
  const [venuesLoaded, setVenuesLoaded] = useState(false);
  // Keyed by venue reference — a course id, or `draft:<key>` for a club named
  // here. One entry per venue is the whole rule: picking a venue twice is not
  // expressible, so a second round at the same club can't be created.
  const [rounds, setRounds] = useState<Record<string, VenueRound>>({});
  const [roundErrors, setRoundErrors] = useState<Record<string, string>>({});
  const [customVenues, setCustomVenues] = useState<CustomVenueDraft[]>([]);
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
   * A club the applicant named that isn't on LinkUp yet. Nothing is created
   * here — the draft lives in form state and becomes a pending course only when
   * the application is submitted, so a form that's abandoned halfway leaves no
   * orphaned course behind.
   *
   * It arrives blank and stays editable: the name, the website and the round all
   * sit in the same card as every other selected venue's.
   */
  const addCustomVenue = () => {
    const key = ++venueKey.current;
    setCustomVenues((prev) => [...prev, { key, name: "", website: "" }]);
    setRounds((prev) => ({ ...prev, [`${DRAFT_VENUE}${key}`]: newRound() }));
    setVenueError(null);
  };

  const updateCustomVenue = (key: number, patch: Partial<CustomVenueDraft>) =>
    setCustomVenues((prev) =>
      prev.map((v) => (v.key === key ? { ...v, ...patch } : v)),
    );

  const removeCustomVenue = (key: number) => {
    setCustomVenues((prev) => prev.filter((v) => v.key !== key));
    // The round goes with the venue — it has nowhere to be held otherwise.
    setRounds((prev) => {
      const next = { ...prev };
      delete next[`${DRAFT_VENUE}${key}`];
      return next;
    });
  };

  /**
   * Selecting a venue creates its round; deselecting removes it. There is no
   * separate "add a round" step, which is what used to make a second round at an
   * already-chosen venue possible.
   */
  const toggleVenue = (id: string) => {
    const selected = venueIds.includes(id);
    setVenueIds((prev) =>
      selected ? prev.filter((v) => v !== id) : [...prev, id],
    );
    setRounds((prev) => {
      if (selected) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: newRound() };
    });
    setVenueError(null);
  };

  const updateRound = (ref: string, patch: Partial<VenueRound>) =>
    setRounds((prev) => {
      const current = prev[ref];
      if (!current) return prev;
      return { ...prev, [ref]: { ...current, ...patch } };
    });

  /** Every venue on this application, in the order they're shown. */
  const selectedVenues: {
    ref: string;
    label: string;
    pending: boolean;
    custom?: CustomVenueDraft;
  }[] = [
    ...venues
      .filter((v) => venueIds.includes(v.id))
      .map((v) => ({
        ref: v.id,
        label: v.city ? `${v.name} — ${v.city}` : v.name,
        pending: v.approval_status === "pending",
      })),
    ...customVenues.map((v) => ({
      ref: `${DRAFT_VENUE}${v.key}`,
      label: v.name.trim(),
      pending: true,
      custom: v,
    })),
  ];

  // Only what's left to pick — anything chosen has moved up into a card, so the
  // list below never shows the same venue twice.
  const unselectedVenues = venues.filter((v) => !venueIds.includes(v.id));

  const todayISO = new Date().toISOString().slice(0, 10);

  /**
   * Validate the rounds up front rather than letting the server reject the whole
   * application over one field. Mirrors validateHostedEventPayload, which is what
   * these are checked against again on submit and on approval.
   */
  const validateRounds = (): ProposedRound[] | null => {
    const errs: Record<string, string> = {};
    const payload: ProposedRound[] = [];

    // Custom venues are sent as a list; a round at one references it by position.
    const draftIndex = new Map(
      customVenues.map((v, i) => [`${DRAFT_VENUE}${v.key}`, i]),
    );

    for (const { ref } of selectedVenues) {
      const r = rounds[ref];
      // A venue with an untouched round is requested without a proposed date —
      // still a valid application.
      if (!r || !roundStarted(r)) continue;

      const dates = r.dates.map((d) => d.trim()).filter(Boolean);
      if (dates.length === 0) {
        errs[ref] = "Choose a date.";
        continue;
      }
      if (dates.length !== r.dates.length) {
        errs[ref] = "Fill in or remove the empty date.";
        continue;
      }
      if (new Set(dates).size !== dates.length) {
        errs[ref] = "Each date can only be added once.";
        continue;
      }
      if (dates.some((d) => d < todayISO)) {
        errs[ref] = "Date cannot be in the past.";
        continue;
      }
      const spots = Number(r.total_spots);
      if (!Number.isInteger(spots) || spots < 1 || spots > 200) {
        errs[ref] = "Spots must be a whole number between 1 and 200.";
        continue;
      }
      const rate = Number(r.member_guest_rate);
      if (r.member_guest_rate === "" || !Number.isFinite(rate) || rate < 0) {
        errs[ref] = "Enter the guest rate.";
        continue;
      }
      // A draft venue has no id yet, so it travels as its position in new_venues.
      const draftPos = draftIndex.get(ref);
      const venueRef =
        draftPos === undefined ? ref : `${NEW_VENUE_REF}${draftPos}`;

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
    const badSite = customVenues.find(
      (v) => v.website.trim() && !/^https?:\/\/.+/i.test(v.website.trim()),
    );
    if (badSite) {
      setVenueError("Website must be a valid URL (https://…).");
      return;
    }
    setVenueError(null);

    const events = validateRounds();
    if (!events) return;

    const ok = await onSubmit({
      name: data.name.trim(),
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
      setRounds({});
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
        <span className="text-xs text-green-900/50 mb-1.5 block">
          Which venues do you want to host at?
        </span>

        {/* Chosen venues, each holding the round it would run. Selecting a venue
            moves it up here so what's on the application is one list rather than
            ticks scattered through a long roster — and the round sits with the
            venue it belongs to instead of in a separate section pointing back at
            it through a dropdown. */}
        {selectedVenues.length > 0 && (
          <div className="space-y-2 mb-2">
            {selectedVenues.map(({ ref, label, pending, custom }) => {
              const round = rounds[ref];
              if (!round) return null;
              return (
                <div
                  key={ref}
                  className="rounded-xl border border-green-900/20 bg-green-50/40 px-3 py-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    {custom ? (
                      <input
                        className="input flex-1 min-w-0"
                        placeholder="Golf club name"
                        maxLength={120}
                        value={custom.name}
                        autoFocus={
                          custom.name === "" && custom.key === venueKey.current
                        }
                        onChange={(e) =>
                          updateCustomVenue(custom.key, { name: e.target.value })
                        }
                      />
                    ) : (
                      <span className="text-sm font-medium text-green-900 flex-1 min-w-0 truncate">
                        {label}
                      </span>
                    )}
                    {pending && (
                      <span className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full text-yellow-700 bg-yellow-50">
                        {custom ? "New" : "Pending"}
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${label || "venue"}`}
                      onClick={() =>
                        custom ? removeCustomVenue(custom.key) : toggleVenue(ref)
                      }
                      className="flex-shrink-0 text-green-900/40 hover:text-red-500 p-0.5"
                    >
                      <X className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </div>

                  {custom && (
                    <input
                      className="input"
                      placeholder="Website link — https://…"
                      maxLength={200}
                      value={custom.website}
                      onChange={(e) =>
                        updateCustomVenue(custom.key, {
                          website: e.target.value,
                        })
                      }
                    />
                  )}

                  {/* One round per venue. Several dates on it become one event
                      each — which is what a second round here would have been. */}
                  {round.dates.map((d, di) => (
                    <div key={di} className="flex items-center gap-2">
                      <input
                        type="date"
                        className="input"
                        min={todayISO}
                        value={d}
                        onChange={(e) =>
                          updateRound(ref, {
                            dates: round.dates.map((v, vi) =>
                              vi === di ? e.target.value : v,
                            ),
                          })
                        }
                      />
                      {round.dates.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove date ${di + 1}`}
                          onClick={() =>
                            updateRound(ref, {
                              dates: round.dates.filter((_, vi) => vi !== di),
                            })
                          }
                          className="text-green-900/40 hover:text-red-500 p-0.5"
                        >
                          <X className="h-4 w-4" strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  ))}

                  {round.dates.length < MAX_DATES_PER_ROUND && (
                    <button
                      type="button"
                      onClick={() =>
                        updateRound(ref, { dates: [...round.dates, ""] })
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
                    value={round.tee_time}
                    onChange={(e) =>
                      updateRound(ref, { tee_time: e.target.value })
                    }
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      className="input"
                      min={1}
                      max={200}
                      placeholder="Available spots"
                      value={round.total_spots}
                      onChange={(e) =>
                        updateRound(ref, { total_spots: e.target.value })
                      }
                    />
                    <input
                      type="number"
                      className="input"
                      min={0}
                      step="1"
                      placeholder="Member guest rate"
                      value={round.member_guest_rate}
                      onChange={(e) =>
                        updateRound(ref, { member_guest_rate: e.target.value })
                      }
                    />
                  </div>

                  <label className="flex items-center gap-3 text-sm text-green-900/80 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-green-900/30 text-green-900 focus:ring-green-800"
                      checked={round.dinner}
                      onChange={(e) =>
                        updateRound(ref, { dinner: e.target.checked })
                      }
                    />
                    Dinner included
                  </label>

                  {roundErrors[ref] && (
                    <p className="text-xs text-red-500">{roundErrors[ref]}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={addCustomVenue}
          disabled={customVenues.length >= MAX_CUSTOM_VENUES}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-green-900/25 px-3 py-2.5 text-sm text-green-900/70 mb-1.5 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Add new venue
        </button>

        {!venuesLoaded ? (
          <p className="text-xs text-green-900/35">Loading venues…</p>
        ) : (
          unselectedVenues.length > 0 && (
            <div className="space-y-1.5">
              {unselectedVenues.map((v) => (
                <label
                  key={v.id}
                  className="flex items-center gap-3 rounded-xl border border-green-900/10 px-3 py-2.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-green-900/30 text-green-900 focus:ring-green-800"
                    checked={false}
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
          )
        )}
        {venueError && (
          <p className="text-xs text-red-500 mt-1.5">{venueError}</p>
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
