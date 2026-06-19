"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import Icon from "@/components/ui/Icon";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useProfile } from "@/hooks/useProfile";

const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/members", label: "Members", icon: "members" },
  { href: "/messages", label: "Messages", icon: "messages" },
  { href: "/book", label: "Book", icon: "book" },
  { href: "/more", label: "More", icon: "more" },
] as const;

// Messages moves to the top-bar header on mobile; bottom nav shows 4 items
const BOTTOM_NAV_ITEMS = NAV_ITEMS.filter((i) => i.href !== "/messages");

const DISMISSED_KEY = "linkup-notif-prompt-dismissed";

// Sidebar (tablet+) and bottom nav (mobile) — both need usePathname for
// active-state highlighting, so this is the minimal client boundary.
export default function AppNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { permission, isSubscribed, subscribe } = usePushNotifications();
  const { profile, loading } = useProfile();
  const [dismissed, setDismissed] = useState(true); // start hidden, reveal after mount
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    if (loading) return;
    const px = profile?.profile?.text_size ?? 16;
    document.documentElement.style.fontSize = `${px}px`;
    setFontReady(true);
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

  async function handleEnable() {
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
  }

  function handleDismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  if (!fontReady) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ background: "var(--color-cream)" }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-5 h-5 rounded-full border-2 animate-spin"
            style={{
              borderColor: "rgba(0,38,105,0.12)",
              borderTopColor: "var(--color-green-900)",
            }}
          />
        </div>
      </div>
    );
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

        <nav className="flex flex-col gap-px py-4 flex-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("sidebar-nav-item", active && "active")}
                aria-current={active ? "page" : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
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
          <div
            className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
            style={{ background: "var(--color-green-900)" }}
          >
            <span className="text-lg flex-shrink-0">🔔</span>
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
                className="text-xs text-white/40 hover:text-white/70 transition-colors px-1"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <main className="screen-content">{children}</main>

        {/* Bottom nav — mobile only */}
        <nav className="bottom-nav">
          <div className="flex">
            {BOTTOM_NAV_ITEMS.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn("nav-item", active && "active")}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={item.icon} className="w-6 h-6" />
                  <span className="nav-label">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
