"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useProfile } from "@/hooks/useProfile";
import { isGuestOnly } from "@/lib/ghl/tags";
import { BECOME_A_MEMBER_PATH, isOpenToGuests } from "@/lib/auth/guest-paths";

// Sends a guest to /become-a-member from any page that isn't theirs. The
// middleware already does this on the server for every page load; this covers
// navigation that never reaches it, like switching /book to its "Book a round"
// tab. Renders nothing. Admins are exempt, as they are everywhere else.
export default function GuestRedirect() {
  const { profile, loading } = useProfile();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const mustLeave =
    !loading &&
    !!profile &&
    !profile.is_admin &&
    isGuestOnly(profile.ghl_tags ?? []) &&
    !isOpenToGuests(pathname ?? "", searchParams?.get("tab") ?? null);

  useEffect(() => {
    if (mustLeave) router.replace(BECOME_A_MEMBER_PATH);
  }, [mustLeave, router]);

  return null;
}
