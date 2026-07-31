"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { COURSE_SLUGS } from "@/lib/ghl/tags";
import {
  AdminPageHeader,
  StatCard,
  AdminCard,
  AdminButton,
  Badge,
  ProgressBar,
} from "@/components/admin/AdminUI";
import { formatRelativeTime, formatTeeTime } from "@/lib/utils";
import { format, startOfMonth, endOfMonth } from "date-fns";

interface DashboardData {
  totalMembers: number;
  activeMembers: number;
  waitlistCount: number;
  pendingCount: number;
  roundsThisMonth: number;
  maxRounds: number;
  reservedRounds: number;
  pendingGuestAccess: number;
  pendingBookingRequests: number;
  recentMembers: Array<{
    id: string;
    first_name: string;
    last_name: string;
    created_at: string;
    membership_status: string;
  }>;
  recentBookings: Array<{
    id: string;
    created_at: string;
    booking_date: string;
    tee_time: string;
    status: string;
    amount_charged: number;
    member: { first_name: string; last_name: string } | null;
  }>;
  recentBookingsError: string | null;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    const supabase = createClient();

    const { data: courses } = await supabase
      .from("courses")
      .select("id, max_members, max_rounds_per_month, reserved_rounds")
      .in("slug", COURSE_SLUGS);

    if (!courses?.length) {
      setLoading(false);
      return;
    }

    const courseIds = courses.map(c => c.id);
    const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");

    const [
      membersRes,
      waitlistRes,
      pendingRes,
      roundsRes,
      guestRes,
      bookingReqRes,
      recentMembersRes,
      recentBookingsRes,
    ] = await Promise.all([
      supabase
        .from("members")
        .select("id", { count: "exact" })
        .in("home_course_id", courseIds)
        .eq("membership_status", "active"),
      supabase
        .from("members")
        .select("id", { count: "exact" })
        .in("home_course_id", courseIds)
        .eq("membership_status", "waitlist"),
      supabase
        .from("members")
        .select("id", { count: "exact" })
        .in("home_course_id", courseIds)
        .eq("membership_status", "pending"),
      supabase
        .from("bookings")
        .select("id", { count: "exact" })
        .in("course_id", courseIds)
        .eq("status", "confirmed")
        .gte("booking_date", monthStart)
        .lte("booking_date", monthEnd),
      supabase
        .from("guest_access_requests")
        .select("id", { count: "exact" })
        .in("target_course_id", courseIds)
        .eq("status", "pending"),
      supabase
        .from("bookings")
        .select("id", { count: "exact" })
        .in("course_id", courseIds)
        .eq("status", "awaiting_approval"),
      supabase
        .from("members")
        .select("id, first_name, last_name, created_at, membership_status")
        .in("home_course_id", courseIds)
        .order("created_at", { ascending: false })
        .limit(5),
      // The 5 most recently *made* bookings, whatever state they're in. Two
      // things to keep in mind here:
      //  - `bookings` has two FKs to `members` (member_id and player_member_id),
      //    so the embed must name the one it wants or PostgREST 300s.
      //  - order by created_at, not booking_date: booking_date desc returns the
      //    furthest-out tee times, which is a different card entirely.
      supabase
        .from("bookings")
        .select(
          "id, created_at, booking_date, tee_time, status, amount_charged, member:members!bookings_member_id_fkey(first_name, last_name)",
        )
        .in("course_id", courseIds)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const maxRounds = courses.reduce((sum, c) => sum + c.max_rounds_per_month - c.reserved_rounds, 0);
    const reservedRounds = courses.reduce((sum, c) => sum + c.reserved_rounds, 0);

    setData({
      totalMembers: membersRes.count ?? 0,
      activeMembers: membersRes.count ?? 0,
      waitlistCount: waitlistRes.count ?? 0,
      pendingCount: pendingRes.count ?? 0,
      roundsThisMonth: roundsRes.count ?? 0,
      maxRounds,
      reservedRounds,
      pendingGuestAccess: guestRes.count ?? 0,
      pendingBookingRequests: bookingReqRes.count ?? 0,
      recentMembers: recentMembersRes.data ?? [],
      recentBookings: (recentBookingsRes.data ??
        []) as unknown as DashboardData["recentBookings"],
      // A failed query and a course with no bookings both leave `data` null —
      // don't let the first one quietly render as "no bookings yet".
      recentBookingsError: recentBookingsRes.error?.message ?? null,
    });
    setLoading(false);
  }

  if (loading || !data) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-gray-200 rounded" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 sm:h-28 bg-gray-100 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const pendingActions =
    data.pendingGuestAccess +
    data.pendingBookingRequests +
    data.pendingCount;

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Dashboard"
        description={`Park Hyatt Aviara · ${format(new Date(), "MMMM yyyy")}`}
      />

      {/* Pending action alert */}
      {pendingActions > 0 && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div>
            <p className="text-sm font-medium text-yellow-800">
              {pendingActions} item{pendingActions !== 1 ? "s" : ""} require
              your attention
            </p>
            <p className="text-xs text-yellow-600 mt-0.5">
              {data.pendingGuestAccess > 0 &&
                `${data.pendingGuestAccess} guest access · `}
              {data.pendingBookingRequests > 0 &&
                `${data.pendingBookingRequests} booking requests · `}
              {data.pendingCount > 0 &&
                `${data.pendingCount} member applications`}
            </p>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active members"
          value={data.activeMembers}
          sub={`of 200 capacity · ${data.waitlistCount} waitlisted`}
          colour={
            data.activeMembers >= 190
              ? "red"
              : data.activeMembers >= 160
                ? "gold"
                : "green"
          }
        />
        <StatCard
          label="Rounds this month"
          value={data.roundsThisMonth}
          sub={`of ${data.maxRounds} member allocation`}
          colour={
            data.roundsThisMonth >= data.maxRounds * 0.9 ? "red" : "green"
          }
        />
        <StatCard
          label="Guest access requests"
          value={data.pendingGuestAccess}
          sub="Travel requests awaiting approval"
          colour={data.pendingGuestAccess > 0 ? "gold" : "gray"}
        />
        <StatCard
          label="Booking requests"
          value={data.pendingBookingRequests}
          sub="Non-member guests awaiting approval"
          colour={data.pendingBookingRequests > 0 ? "gold" : "gray"}
        />
      </div>

      {/* Capacity detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
        <AdminCard title="Membership capacity">
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Active members</span>
                <span className="font-medium">{data.activeMembers} / 200</span>
              </div>
              <ProgressBar value={data.activeMembers} max={200} />
            </div>
            <div className="grid grid-cols-3 gap-3 pt-2">
              <CapStat
                label="Active"
                value={data.activeMembers}
                colour="text-green-700"
              />
              <CapStat
                label="Waitlist"
                value={data.waitlistCount}
                colour="text-yellow-600"
              />
              <CapStat
                label="Pending"
                value={data.pendingCount}
                colour="text-blue-600"
              />
            </div>
          </div>
        </AdminCard>

        <AdminCard title="Round utilisation — this month">
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Member rounds</span>
                <span className="font-medium">
                  {data.roundsThisMonth} / {data.maxRounds}
                </span>
              </div>
              <ProgressBar value={data.roundsThisMonth} max={data.maxRounds} />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <CapStat
                label="Member allocation"
                value={data.maxRounds}
                colour="text-green-700"
              />
              <CapStat
                label="Reserved (NBD + events)"
                value={data.reservedRounds}
                colour="text-gray-500"
              />
            </div>
          </div>
        </AdminCard>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AdminCard
          title="Recent members"
          action={
            <AdminButton
              label="View all"
              onClick={() => router.push("/admin/members")}
              variant="ghost"
              size="sm"
            />
          }
        >
          {data.recentMembers.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No members yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recentMembers.map((m) => (
                <div key={m.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800 capitalize">
                      {m.first_name}{" "}
                      {m.last_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatRelativeTime(m.created_at)}
                    </p>
                  </div>
                  <StatusBadge status={m.membership_status} />
                </div>
              ))}
            </div>
          )}
        </AdminCard>

        <AdminCard
          title="Recent bookings"
          action={
            <AdminButton
              label="View all"
              onClick={() => router.push("/admin/bookings")}
              variant="ghost"
              size="sm"
            />
          }
        >
          {data.recentBookingsError ? (
            <p className="text-sm text-red-500">
              Could not load bookings — {data.recentBookingsError}
            </p>
          ) : data.recentBookings.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No bookings yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recentBookings.map((b) => {
                const name = `${b.member?.first_name ?? ""} ${b.member?.last_name ?? ""}`.trim();
                const amount = Number(b.amount_charged);
                return (
                  <div key={b.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 capitalize truncate">
                        {name || "Unknown member"}
                      </p>
                      <p className="text-xs text-gray-400">
                        Tee{" "}
                        {format(new Date(b.booking_date + "T12:00:00"), "MMM d")}{" "}
                        · {formatTeeTime(b.tee_time)}
                      </p>
                      <p className="text-xs text-gray-400">
                        Booked {formatRelativeTime(b.created_at)}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <BookingStatusBadge status={b.status} />
                      <p
                        className={
                          amount > 0
                            ? "text-sm font-medium text-green-700 mt-1"
                            : "text-sm text-gray-300 mt-1"
                        }
                      >
                        {amount > 0 ? `$${amount.toFixed(0)}` : "—"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  );
}

function CapStat({
  label,
  value,
  colour,
}: {
  label: string;
  value: number;
  colour: string;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className={`text-2xl font-bold ${colour}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

// Booking statuses, labelled to match /admin/bookings. A booking starts life as
// tentative/awaiting_approval, so the recent list is mostly non-confirmed rows.
function BookingStatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; colour: "green" | "yellow" | "blue" | "red" | "gray" }
  > = {
    awaiting_approval: { label: "Awaiting approval", colour: "red" },
    tentative: { label: "Tentative", colour: "yellow" },
    availability_confirmed: { label: "Avail. confirmed", colour: "blue" },
    payment_confirmed: { label: "Paid", colour: "green" },
    confirmed: { label: "Confirmed", colour: "green" },
    pending: { label: "Pending", colour: "yellow" },
    cancelled: { label: "Cancelled", colour: "gray" },
    waitlist: { label: "Waitlist", colour: "gray" },
  };
  const s = map[status] ?? { label: status, colour: "gray" as const };
  return <Badge label={s.label} colour={s.colour} />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; colour: "green" | "yellow" | "blue" | "red" | "gray" }
  > = {
    active: { label: "Active", colour: "green" },
    waitlist: { label: "Waitlist", colour: "yellow" },
    pending: { label: "Pending", colour: "blue" },
    suspended: { label: "Suspended", colour: "red" },
    cancelled: { label: "Cancelled", colour: "gray" },
  };
  const s = map[status] ?? { label: status, colour: "gray" as const };
  return <Badge label={s.label} colour={s.colour} />;
}
