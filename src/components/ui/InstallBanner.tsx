"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { X, ChevronRight } from "lucide-react";
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

  return (
    <div className="mx-4 my-2 relative animate-fade-up">
      <button
        onClick={dismiss}
        className="focus-ring absolute top-2.5 right-2.5 z-10 w-6 h-6 flex items-center justify-center rounded-full text-green-900/40 hover:text-green-900/70 hover:bg-green-900/06 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" strokeWidth={2.25} />
      </button>

      <Link
        href="/install"
        className="card pressable focus-ring flex items-center gap-3 px-4 py-3.5 pr-9"
      >
        <Image
          src="/linkup-golf.webp"
          alt="LinkUp Golf"
          width={38}
          height={38}
          className="rounded-xl flex-shrink-0"
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-green-900">
            Install LinkUp Golf
          </p>
          <p className="text-xs mt-0.5 font-medium text-green-600 flex items-center gap-0.5">
            Tap for installation guide <ChevronRight className="w-3 h-3" strokeWidth={2.5} />
          </p>
        </div>
      </Link>
    </div>
  );
}
