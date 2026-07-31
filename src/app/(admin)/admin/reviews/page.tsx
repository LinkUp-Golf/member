"use client";

// Member satisfaction reviews — the responses collected by the post-round
// survey prompt (see src/components/surveys/BookingSurveyPrompt.tsx).

import { useState, useEffect, useMemo, useCallback } from "react";
import { Star } from "lucide-react";
import {
  AdminPageHeader,
  StatCard,
  AdminTable,
  AdminTr,
  AdminTd,
  Badge,
} from "@/components/admin/AdminUI";
import { createClient } from "@/lib/supabase";
import { cn, formatTeeTime, formatRelativeTime } from "@/lib/utils";
import { format } from "date-fns";

interface Review {
  id: string;
  rating: number;
  attended: boolean;
  comment: string | null;
  created_at: string;
  member: { first_name: string; last_name: string; email: string } | null;
  course: { id: string; name: string } | null;
  booking: { booking_date: string; tee_time: string } | null;
}

type RatingFilter = "all" | "1" | "2" | "3" | "4" | "5" | "no-show";

const PAGE_SIZE = 100;

function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn("w-3.5 h-3.5", n <= value ? "text-yellow-500 fill-yellow-500" : "text-gray-200 fill-gray-200")}
          strokeWidth={1.5}
          aria-hidden
        />
      ))}
    </span>
  );
}

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courseFilter, setCourseFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");

  const load = useCallback(async () => {
    const supabase = createClient();
    // RLS restricts this to admins (is_admin() in the booking_surveys policy).
    const { data, error: err } = await supabase
      .from("booking_surveys")
      .select(
        "id, rating, attended, comment, created_at, member:members!booking_surveys_member_id_fkey(first_name, last_name, email), course:courses!booking_surveys_course_id_fkey(id, name), booking:bookings!booking_surveys_booking_id_fkey(booking_date, tee_time)",
      )
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (err) {
      setError(err.message);
    } else {
      setError(null);
      setReviews((data ?? []) as unknown as Review[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const courses = useMemo(() => {
    const map = new Map<string, string>();
    reviews.forEach((r) => {
      if (r.course) map.set(r.course.id, r.course.name);
    });
    return [...map.entries()].sort((a, b) => (a[1] ?? "").localeCompare(b[1] ?? ""));
  }, [reviews]);

  const scoped = useMemo(
    () => reviews.filter((r) => courseFilter === "all" || r.course?.id === courseFilter),
    [reviews, courseFilter],
  );

  const filtered = useMemo(
    () =>
      scoped.filter((r) =>
        ratingFilter === "all"
          ? true
          : ratingFilter === "no-show"
            ? !r.attended
            : r.rating === Number(ratingFilter),
      ),
    [scoped, ratingFilter],
  );

  // A response from someone who never played rates the booking experience, not
  // the round — averaging the two together would misrepresent both.
  const attended = useMemo(() => scoped.filter((r) => r.attended), [scoped]);
  const average = attended.length
    ? attended.reduce((sum, r) => sum + r.rating, 0) / attended.length
    : 0;
  const noShows = scoped.length - attended.length;
  const detractors = attended.filter((r) => r.rating <= 2).length;

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-56 bg-gray-200 rounded" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 sm:h-28 bg-gray-100 rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Member Reviews"
        description="Satisfaction ratings collected after each round finishes"
      />

      {error ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-10 text-center">
          <p className="text-sm text-red-500">Could not load reviews — {error}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Average rating"
              value={attended.length ? average.toFixed(1) : "—"}
              sub={
                attended.length
                  ? `across ${attended.length} played round${attended.length === 1 ? "" : "s"}`
                  : "no rated rounds yet"
              }
              colour={!attended.length ? "gray" : average >= 4 ? "green" : average >= 3 ? "gold" : "red"}
            />
            <StatCard
              label="Responses"
              value={scoped.length}
              sub={courseFilter === "all" ? "all courses" : "this course"}
            />
            <StatCard
              label="Did not attend"
              value={noShows}
              sub="members who missed their round"
              colour={noShows > 0 ? "gold" : "gray"}
            />
            <StatCard
              label="1–2 stars"
              value={detractors}
              sub="played rounds needing follow-up"
              colour={detractors > 0 ? "red" : "gray"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            {courses.length > 1 && (
              <select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700"
                aria-label="Filter by course"
              >
                <option value="all">All courses</option>
                {courses.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value as RatingFilter)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700"
              aria-label="Filter by rating"
            >
              <option value="all">All ratings</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={String(n)}>
                  {n} star{n === 1 ? "" : "s"}
                </option>
              ))}
              <option value="no-show">Did not attend</option>
            </select>
            <span className="text-xs text-gray-400">
              {filtered.length} of {reviews.length} shown
              {reviews.length === PAGE_SIZE ? " (latest 100)" : ""}
            </span>
          </div>

          <AdminTable
            headers={["Member", "Rating", "Round", "Feedback", "Submitted"]}
            empty={filtered.length === 0 ? "No reviews match this filter." : undefined}
          >
            {filtered.map((r) => (
              <AdminTr key={r.id}>
                <AdminTd>
                  <p className="font-medium text-gray-800 capitalize whitespace-nowrap">
                    {r.member ? `${r.member.first_name} ${r.member.last_name}` : "Unknown member"}
                  </p>
                  <p className="text-xs text-gray-400">{r.member?.email ?? ""}</p>
                </AdminTd>
                <AdminTd>
                  <Stars value={r.rating} />
                  {!r.attended && (
                    <div className="mt-1">
                      <Badge label="Did not attend" colour="gold" />
                    </div>
                  )}
                </AdminTd>
                <AdminTd>
                  <p className="whitespace-nowrap">{r.course?.name ?? "—"}</p>
                  <p className="text-xs text-gray-400 whitespace-nowrap">
                    {r.booking
                      ? `${format(new Date(`${r.booking.booking_date}T12:00:00`), "MMM d")} · ${formatTeeTime(r.booking.tee_time)}`
                      : "Booking removed"}
                  </p>
                </AdminTd>
                <AdminTd className="max-w-xs">
                  {r.comment ? (
                    <p className="text-gray-600 whitespace-pre-wrap break-words">{r.comment}</p>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </AdminTd>
                <AdminTd className="text-xs text-gray-400 whitespace-nowrap">
                  {formatRelativeTime(r.created_at)}
                </AdminTd>
              </AdminTr>
            ))}
          </AdminTable>
        </>
      )}
    </div>
  );
}
