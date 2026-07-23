"use client";

import { useEffect, useState, useCallback, memo, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Bell, X } from "lucide-react";
import { cn } from "@/lib/utils";
import Icon, { type IconName } from "@/components/ui/Icon";
import { FullScreenLoader } from "@/components/ui/Loading";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useProfile } from "@/hooks/useProfile";
import { getMoreItems } from "@/lib/nav/moreItems";
import { useMemberRoles } from "@/hooks/useMemberRoles";
import { PARTNER_ROLE_TAG, HOST_ROLE_TAG } from "@/lib/ghl/tags";

// Extracted + memoized so a pathname change (i.e. every navigation) only
// re-renders the one or two nav rows whose `active` flag actually flips,
// instead of every row in the sidebar/bottom nav reconciling on each route change.
const SidebarNavLink = memo(function SidebarNavLink({
  href, icon, iconName, label, active, external, small,
}: {
  href: string;
  /** Pre-built icon element — must be a stable reference (e.g. a module-level
   *  constant like MORE_ITEMS' icons) or it defeats this component's memoization. */
  icon?: ReactNode;
  /** Preferred over `icon` for plain named icons — rendered internally so the
   *  element itself is created fresh only when this row actually re-renders. */
  iconName?: IconName;
  label: string;
  active: boolean;
  external?: boolean;
  small?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={cn("sidebar-nav-item focus-ring", small && "text-sm", active && "active")}
      aria-current={active ? "page" : undefined}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active-pill"
          className="absolute inset-0"
          style={{ background: "rgba(133,187,101,0.1)", borderRight: "2px solid var(--color-gold)" }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-3">
        {iconName ? <Icon name={iconName} /> : icon}
        <span>{label}</span>
      </span>
    </Link>
  );
});

const BottomNavLink = memo(function BottomNavLink({
  href, iconName, label, active,
}: { href: string; iconName: IconName; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn("nav-item focus-ring", active && "active")}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
      <motion.div
        className="relative flex flex-col items-center gap-1"
        whileTap={{ scale: 0.88 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
      >
        {active && (
          <motion.div
            layoutId="bottom-nav-active-pill"
            className="absolute -inset-x-3.5 -inset-y-1.5 rounded-2xl -z-10"
            style={{ background: "rgba(133,187,101,0.16)" }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          />
        )}
        <Icon name={iconName} className="w-6 h-6" />
        <span className="nav-label">{label}</span>
      </motion.div>
    </Link>
  );
});

const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/members", label: "Members", icon: "members" },
  { href: "/messages", label: "Messages", icon: "messages" },
  { href: "/book", label: "Book", icon: "book" },
  { href: "/more", label: "More", icon: "more" },
] as const;

// Messages moves to the top-bar header on mobile; bottom nav shows 4 items
const BOTTOM_NAV_ITEMS = NAV_ITEMS.filter((i) => i.href !== "/messages");

// The sidebar (tablet+) has room to list every More item directly instead of
// hiding them behind a click — only the bottom nav (mobile) needs the /more
// hub page as a single tab.
const SIDEBAR_TOP_ITEMS = NAV_ITEMS.filter((i) => i.href !== "/more");

const DISMISSED_KEY = "linkup-notif-prompt-dismissed";

// Sidebar (tablet+) and bottom nav (mobile) — both need usePathname for
// active-state highlighting, so this is the minimal client boundary.
export default function AppNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { permission, isSubscribed, subscribe } = usePushNotifications();
  const { profile, loading } = useProfile();
  const roles = useMemberRoles();
  const moreGroups = getMoreItems(roles);
  const [dismissed, setDismissed] = useState(true); // start hidden, reveal after mount

  // A non-member (a referral partner / host with no golf membership, so no home
  // course) has no membership features — the member app is hidden from them and
  // they're sent to their workspace. Enforced app-wide here since AppNav wraps
  // every member route.
  const isNonMember = !loading && !!profile && !profile.home_course_id;
  useEffect(() => {
    if (!isNonMember) return;
    const tags = profile?.ghl_tags ?? [];
    router.replace(
      tags.includes(PARTNER_ROLE_TAG) ? "/partner"
      : tags.includes(HOST_ROLE_TAG) ? "/host"
      : "/membership-required"
    );
  }, [isNonMember, profile, router]);

  // Applies the member's saved text-size preference once it loads. The shell
  // (nav/sidebar) renders immediately at the browser default — there's no
  // need to block the whole layout behind this, it's a one-line style tweak.
  useEffect(() => {
    if (loading) return;
    const px = profile?.profile?.text_size ?? 16;
    document.documentElement.style.fontSize = `${px}px`;
  }, [loading, profile]);

  // Show the in-app prompt banner when permission hasn't been decided yet
  // and the user hasn't dismissed it before. Must be user-gesture driven
  // (iOS Safari blocks Notification.requestPermission without a click).
  useEffect(() => {
    const wasDismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    if (!wasDismissed) setDismissed(false);
  }, []);

  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState("");

  const showPrompt = !dismissed && permission === "default" && !isSubscribed;

  const handleEnable = useCallback(async () => {
    setEnabling(true);
    setEnableError("");
    const ok = await subscribe();
    setEnabling(false);

    if (ok) {
      // Success — permission is now 'granted', showPrompt becomes false naturally
      return;
    }

    if (permission === "denied") {
      // User blocked notifications in the browser — persist dismiss so banner
      // doesn't keep reappearing on every load
      localStorage.setItem(DISMISSED_KEY, "1");
      setDismissed(true);
    } else {
      // Something else failed (SW timeout, server error) — keep banner visible
      // with an inline error so the user can try again
      setEnableError("Could not enable. Please try again.");
    }
  }, [subscribe, permission]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }, []);

  // Don't paint the member shell/features for a non-member — hold a loader
  // while the effect above redirects them to their workspace.
  if (isNonMember) {
    return <FullScreenLoader />;
  }

  return (
    <div className="app-shell">
      {/* Sidebar — tablet+ */}
      <aside className="app-sidebar">
        <div className="sidebar-logo px-6 py-4">
          <div>
            <div
              className="font-sans text-base leading-none font-semibold"
              style={{ color: "var(--color-gold)" }}
            >
              LinkUp Golf
            </div>
            <p
              className="text-[11px] uppercase tracking-widest mt-1"
              style={{ color: "rgba(255,255,255,0.28)" }}
            >
              Member Portal
            </p>
          </div>
        </div>

        <nav className="flex flex-col gap-px py-4 flex-1 overflow-y-auto hide-scrollbar">
          {SIDEBAR_TOP_ITEMS.map((item) => (
            <SidebarNavLink
              key={item.href}
              href={item.href}
              iconName={item.icon}
              label={item.label}
              active={pathname.startsWith(item.href)}
            />
          ))}

          {/* More items — expanded permanently in the sidebar (tablet+ has the
              room); mobile still gets these via the bottom nav's "More" tab. */}
          {moreGroups.map((group) => (
            <div key={group.group} className="mt-4 first:mt-2">
              <p
                className="px-5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "rgba(255,255,255,0.22)" }}
              >
                {group.group}
              </p>
              {group.items.map((item) => (
                <SidebarNavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  active={pathname.startsWith(item.href)}
                  external={item.external}
                  small
                />
              ))}
            </div>
          ))}
        </nav>

        <div
          className="px-4 py-3 border-t"
          style={{ borderColor: "rgba(255,255,255,0.07)" }}
        >
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.18)" }}>
            Park Hyatt Aviara
          </p>
        </div>
      </aside>

      {/* Content column */}
      <div className="app-content-col">
        {/* Push notification prompt — shown until user enables or dismisses */}
        {showPrompt && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="flex items-center gap-3 px-4 py-3 flex-shrink-0 overflow-hidden"
            style={{ background: "var(--color-green-900)" }}
          >
            <Bell className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-gold)" }} strokeWidth={1.75} />
            <p
              className="flex-1 text-xs leading-snug"
              style={{
                color: enableError ? "#fca5a5" : "rgba(255,255,255,0.8)",
              }}
            >
              {enableError ||
                "Enable notifications to stay updated on bookings, messages, and community activity."}
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleEnable}
                disabled={enabling}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-green-900 disabled:opacity-60"
                style={{ background: "var(--color-gold)" }}
              >
                {enabling ? "…" : enableError ? "Retry" : "Enable"}
              </button>
              <button
                onClick={handleDismiss}
                className="focus-ring text-white/40 hover:text-white/70 transition-colors p-1 rounded-lg"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            </div>
          </motion.div>
        )}

        <main className="screen-content">{children}</main>

        {/* Bottom nav — mobile only */}
        <nav className="bottom-nav">
          <div className="flex">
            {BOTTOM_NAV_ITEMS.map((item) => (
              <BottomNavLink
                key={item.href}
                href={item.href}
                iconName={item.icon}
                label={item.label}
                active={pathname.startsWith(item.href)}
              />
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
