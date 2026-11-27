"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useProfile } from "@/hooks/useProfile";
import { isGuestOnly } from "@/lib/ghl/tags";
import { BECOME_A_MEMBER_PATH, isOpenToGuests } from "@/lib/auth/guest-paths";
import {
  FORMER_MEMBER_LANDING_PATH,
  isClosedToFormerMember,
  isFormerMember,
} from "@/lib/auth/former-member";

// Sends a guest to /become-a-member from any page that isn't theirs, and a
// former member to My bookings from a members-only page. The middleware
// already does this on the server for every page load; this covers navigation
// that never reaches it, like switching /book to its "Book a round" tab.
// Renders nothing. Admins are exempt, as they are everywhere else.
export default function GuestRedirect() {
  const { profile, loading } = useProfile();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams?.get("tab") ?? null;

  let destination: string | null = null;
  if (!loading && profile && !profile.is_admin) {
    if (isFormerMember(profile)) {
      if (isClosedToFormerMember(pathname, tab)) destination = FORMER_MEMBER_LANDING_PATH;
    } else if (isGuestOnly(profile.ghl_tags ?? []) && !isOpenToGuests(pathname, tab)) {
      destination = BECOME_A_MEMBER_PATH;
    }
  }

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  return null;
}
