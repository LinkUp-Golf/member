"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useInstallState } from "@/hooks/useInstallState";

const DISMISSED_KEY = "install_banner_dismissed_at";
const REDISPLAY_MS = 7 * 24 * 60 * 60 * 1000;

export default function InstallBanner() {
  const { platform, isStandalone } = useInstallState();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone) return;
    if (platform === "desktop" || platform === "unknown") return;

    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed && Date.now() - Number(dismissed) < REDISPLAY_MS) return;

    setVisible(true);
  }, [platform, isStandalone]);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  const platformLabel =
    platform === "ios-safari" || platform === "ios-other" ? "iPhone" : "Android";

  return (
    <div
      className="mx-4 mb-2 rounded-2xl border flex items-center gap-3 px-4 py-3.5"
      style={{ borderColor: "rgba(133,187,101,0.25)", background: "#f9f8f3" }}
    >
      <Image
        src="/linkup-golf.webp"
        alt="LinkUp Golf"
        width={38}
        height={38}
        className="rounded-xl flex-shrink-0"
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: "#1A2E1A" }}>
          Install LinkUp Golf
        </p>
        <p className="text-xs mt-0.5" style={{ color: "rgba(0,0,0,0.4)" }}>
          Add the app to your {platformLabel} home screen
        </p>
      </div>

      <Link
        href="/install"
        className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white whitespace-nowrap"
        style={{ background: "#1A2E1A" }}
      >
        Installation Guide
      </Link>

      <button
        onClick={dismiss}
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium"
        style={{ background: "rgba(0,0,0,0.06)", color: "rgba(0,0,0,0.35)" }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
