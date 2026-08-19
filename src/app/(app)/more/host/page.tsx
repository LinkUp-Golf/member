"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useForm,
  useFieldArray,
  Controller,
  type Control,
  type FieldErrors,
  type UseFormRegister,
  type UseFormTrigger,
} from "react-hook-form";
import Link from "next/link";
import { Flag, X } from "lucide-react";
import VenueDateSelector from "@/components/host/VenueDateSelector";
import { useProfile } from "@/hooks/useProfile";
import { apiClient } from "@/lib/api-client";
import { Spinner } from "@/components/ui/Loading";
import AppShell from "@/components/layout/AppShell";
import { formatRelativeTime } from "@/lib/utils";
import {
  buildApplicationPayload,
  newRound,
  roundAt,
  roundStarted,
  MAX_DATES_PER_ROUND,
  NAME_MAX,
  NAME_MIN,
  RATE_MAX,
  SPOTS_MAX,
  SPOTS_MIN,
  TEE_TIME_MAX,
  type ApplicationValues,
  type RoundFields,
  type SubmitValues,
} from "@/lib/hosts/application-form";
import type { Host, HostApplication, Course } from "@/types";

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
                onSubmit={async ({ name, course_ids, events }) => {
                  setError(null);
                  const res = await apiClient.post("/api/host/application", {
                    name,
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
//
// Every field is registered with react-hook-form, including the dynamic ones:
// the venues you pick and the dates on each round are `useFieldArray`s rather
// than component state validated by hand at submit. That's what makes an error
// land on the field that caused it — the old pass produced one message per venue
// card and stopped at the first problem, so fixing three bad fields took three
// submits.

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
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<ApplicationValues>({
    defaultValues: { name: "", existing: [] },
    // Validate a field once it's been touched, so a bad date says so while
    // you're still looking at it rather than after a submit.
    mode: "onTouched",
  });

  const existing = useFieldArray({ control, name: "existing" });

  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [venuesLoaded, setVenuesLoaded] = useState(false);

  useEffect(() => {
    apiClient.get<{ courses: VenueOption[] }>("/api/courses").then((res) => {
      if (res.data?.courses) setVenues(res.data.courses);
      // Distinguish "still loading" from "there genuinely are none" — otherwise
      // a failed fetch leaves the applicant staring at a loading line forever.
      setVenuesLoaded(true);
    });
  }, []);

  /**
   * Selecting a venue appends its round; deselecting removes both together.
   * There is no separate "add a round" step, so a second round at a venue that's
   * already on the application isn't expressible.
   */
  const toggleVenue = (v: VenueOption) => {
    const at = existing.fields.findIndex((f) => f.courseId === v.id);
    if (at >= 0) {
      existing.remove(at);
      return;
    }
    existing.append({
      courseId: v.id,
      label: v.city ? `${v.name} — ${v.city}` : v.name,
      pending: v.approval_status === "pending",
      round: newRound(),
    });
    clearErrors("root.venues");
  };

  // Only what's left to pick — anything chosen has moved up into a card, so the
  // list below never shows the same venue twice.
  const unselectedVenues = venues.filter(
    (v) => !existing.fields.some((f) => f.courseId === v.id),
  );

  const submit = handleSubmit(async (data) => {
    // The one rule that isn't a field's own, so it's the one thing still
    // checked here.
    if (data.existing.length === 0) {
      setError("root.venues", {
        message: "Choose at least one venue you want to host at.",
      });
      return;
    }

    const ok = await onSubmit(buildApplicationPayload(data));
    if (ok) reset({ name: "", existing: [] });
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
        {existing.fields.length > 0 && (
          <div className="space-y-2 mb-2">
            {existing.fields.map((field, index) => (
              <VenueCard
                key={field.id}
                index={index}
                label={field.label}
                pendingLabel={field.pending ? "Pending" : null}
                courseId={field.courseId}
                control={control}
                register={register}
                trigger={trigger}
                roundErrors={errors.existing?.[index]?.round}
                onRemove={() => existing.remove(index)}
              />
            ))}

          </div>
        )}

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
                    onChange={() => toggleVenue(v)}
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
        {errors.root?.venues && (
          <p className="text-xs text-red-500 mt-1.5">
            {errors.root.venues.message}
          </p>
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

/**
 * One venue and the round it would host.
 *
 * Its own component because the dates are a nested useFieldArray, and a hook
 * can't be called inside the parent's map. Every card is an existing venue
 * this card sits in, which is all the field paths need to be built.
 */
function VenueCard({
  index,
  label,
  pendingLabel,
  courseId,
  control,
  register,
  trigger,
  roundErrors,
  onRemove,
}: {
  index: number;
  label: string;
  pendingLabel: string | null;
  /** The venue this card is for — its open dates are what the round picks from. */
  courseId: string;
  control: Control<ApplicationValues>;
  register: UseFormRegister<ApplicationValues>;
  trigger: UseFormTrigger<ApplicationValues>;
  roundErrors?: FieldErrors<RoundFields>;
  onRemove: () => void;
}) {
  const prefix = `existing.${index}` as const;
  // A venue can still be requested on its own and dated later — naming the club
  // you want to host at is a complete thing to ask for.
  const roundRequired = false;

  return (
    <div className="rounded-xl border border-green-900/20 bg-green-50/40 px-3 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-green-900 flex-1 min-w-0 truncate">
          {label}
        </span>
        {pendingLabel && (
          <span className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full text-yellow-700 bg-yellow-50">
            {pendingLabel}
          </span>
        )}
        <button
          type="button"
          aria-label={`Remove ${label || "venue"}`}
          onClick={onRemove}
          className="flex-shrink-0 text-green-900/40 hover:text-red-500 p-0.5"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {/* One round per venue, its days picked from what the venue has open.
          Several dates become one event each — which is what a second round
          here would have been. A venue can still be requested with no dates and
          scheduled later. */}
      <Controller
        control={control}
        name={`${prefix}.round.dates` as const}
        rules={{
          validate: (value: { value: string }[]) => {
            const picked = (value ?? []).map(d => d.value).filter(Boolean);
            if (picked.length > MAX_DATES_PER_ROUND)
              return `At most ${MAX_DATES_PER_ROUND} dates.`;
            return true;
          },
        }}
        render={({ field: f }: { field: { value: { value: string }[]; onChange: (v: { value: string }[]) => void } }) => (
          <VenueDateSelector
            courseId={courseId}
            value={(f.value ?? []).map((d: { value: string }) => d.value).filter(Boolean)}
            onChange={(next: string[]) => {
              f.onChange(next.map(value => ({ value })));
              void trigger(`${prefix}.round.dates` as const);
            }}
            max={MAX_DATES_PER_ROUND}
          />
        )}
      />
      {roundErrors?.dates && typeof roundErrors.dates.message === "string" && (
        <p className="text-xs text-red-500">{roundErrors.dates.message}</p>
      )}

      <input
        type="text"
        className="input"
        placeholder="e.g. 8:30 AM (optional)"
        {...register(`${prefix}.round.tee_time` as const, {
          maxLength: {
            value: TEE_TIME_MAX,
            message: `At most ${TEE_TIME_MAX} characters`,
          },
        })}
      />
      {roundErrors?.tee_time && (
        <p className="text-xs text-red-500">{roundErrors.tee_time.message}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          className="input"
          min={SPOTS_MIN}
          max={SPOTS_MAX}
          placeholder="Available spots"
          {...register(`${prefix}.round.total_spots` as const, {
            validate: (value: string, values: ApplicationValues) => {
              if (!roundRequired && !roundStarted(roundAt(values, "existing", index)))
                return true;
              const n = Number(value);
              return (
                (Number.isInteger(n) && n >= SPOTS_MIN && n <= SPOTS_MAX) ||
                `Spots must be a whole number between ${SPOTS_MIN} and ${SPOTS_MAX}.`
              );
            },
          })}
        />
        <input
          type="number"
          className="input"
          min={0}
          step="1"
          placeholder="Member guest rate"
          {...register(`${prefix}.round.member_guest_rate` as const, {
            validate: (value: string, values: ApplicationValues) => {
              if (!roundRequired && !roundStarted(roundAt(values, "existing", index)))
                return true;
              if (value.trim() === "") return "Enter the guest rate.";
              const n = Number(value);
              if (!Number.isFinite(n) || n < 0) return "Enter the guest rate.";
              return n <= RATE_MAX || `At most ${RATE_MAX}.`;
            },
          })}
        />
      </div>
      {roundErrors?.total_spots && (
        <p className="text-xs text-red-500">{roundErrors.total_spots.message}</p>
      )}
      {roundErrors?.member_guest_rate && (
        <p className="text-xs text-red-500">
          {roundErrors.member_guest_rate.message}
        </p>
      )}

      <label className="flex items-center gap-3 text-sm text-green-900/80 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-green-900/30 text-green-900 focus:ring-green-800"
          {...register(`${prefix}.round.dinner` as const)}
        />
        Dinner included
      </label>
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
