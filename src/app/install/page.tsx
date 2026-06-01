"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useInstallState } from "@/hooks/useInstallState";
import { useAndroidInstall } from "@/hooks/useAndroidInstall";

export default function InstallPage() {
  const { platform, isStandalone } = useInstallState();
  const { canInstall, promptInstall } = useAndroidInstall();

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "#F4F1E8" }}
    >
      {/* Header */}
      <div
        className="px-6 pt-12 pb-8 text-center"
        style={{ background: "#0a1f0a" }}
      >
        <div className="flex justify-center mb-4">
          <Image
            src="/logos/logo-white.png"
            alt="LinkUp Golf"
            width={80}
            height={80}
          />
        </div>
        <h1 className="font-sans font-black text-2xl text-white">
          LinkUp Golf
        </h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.5)" }}>
          Member Community
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-8 max-w-sm mx-auto w-full">
        {platform === "unknown" ? (
          <div className="flex justify-center items-center py-16">
            <div className="w-6 h-6 rounded-full border-2 border-green-900/20 border-t-green-900 animate-spin" />
          </div>
        ) : (
          <>
            {isStandalone && <AlreadyInstalled />}
            {!isStandalone && platform === "android" && (
              <AndroidInstructions
                canInstall={canInstall}
                promptInstall={promptInstall}
              />
            )}
            {!isStandalone && platform === "ios-safari" && (
              <IOSSafariInstructions />
            )}
            {!isStandalone && platform === "ios-other" && (
              <IOSOtherInstructions />
            )}
            {!isStandalone && platform === "desktop" && <DesktopInstructions />}
          </>
        )}
      </div>
    </div>
  );
}

// ---- Already installed ------------------------------------------

function AlreadyInstalled() {
  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-4">✓</div>
      <h2 className="font-sans font-black text-xl text-green-900 mb-2">
        You&apos;re all set
      </h2>
      <p className="text-sm text-gray-500">
        LinkUp Golf is already installed on your device.
      </p>
      <a
        href="/home"
        className="mt-6 inline-block px-6 py-3 rounded-xl text-sm font-semibold text-white"
        style={{ background: "#1A2E1A" }}
      >
        Open the app
      </a>
    </div>
  );
}

// ---- Android ---------------------------------------------------

function AndroidInstructions({
  canInstall,
  promptInstall,
}: {
  canInstall: boolean;
  promptInstall: () => void;
}) {
  return (
    <div>
      <h2 className="font-sans font-black text-xl text-green-900 mb-2">
        Install on Android
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Add LinkUp Golf to your home screen for the full app experience.
      </p>

      {canInstall ? (
        <button
          onClick={promptInstall}
          className="w-full py-3.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: "#1A2E1A" }}
        >
          Install App
        </button>
      ) : (
        <ol className="space-y-4">
          <Step n={1}>
            Open this page in <strong>Chrome</strong>
          </Step>
          <Step n={2}>
            Tap the <strong>⋮ menu</strong> in the top-right corner
          </Step>
          <Step n={3}>
            Tap <strong>&ldquo;Add to Home screen&rdquo;</strong>
          </Step>
          <Step n={4}>
            Tap <strong>Add</strong> to confirm
          </Step>
        </ol>
      )}
    </div>
  );
}

// ---- iOS Safari ------------------------------------------------

function IOSSafariInstructions() {
  return (
    <div>
      <h2 className="font-sans font-black text-xl text-green-900 mb-2">
        Install on iPhone
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Follow these steps in Safari to add LinkUp to your home screen.
      </p>
      <ol className="space-y-4">
        <Step n={1}>
          Tap the <strong>Share</strong> button <ShareIcon /> at the bottom of
          Safari
        </Step>
        <Step n={2}>
          Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>
        </Step>
        <Step n={3}>
          Tap <strong>Add</strong> in the top-right corner
        </Step>
      </ol>
      <p className="mt-6 text-xs text-gray-400 text-center">
        The LinkUp icon will appear on your home screen.
      </p>
    </div>
  );
}

// ---- iOS non-Safari (in-app browser / Chrome / Firefox) --------

function IOSOtherInstructions() {
  return (
    <div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-medium text-amber-800">
          Open this page in Safari
        </p>
        <p className="text-xs text-amber-700 mt-1">
          You&apos;re using a browser that doesn&apos;t support installing apps.
          Copy the link and paste it into <strong>Safari</strong> to continue.
        </p>
      </div>
      <h2 className="font-sans font-black text-xl text-green-900 mb-4">
        Then, in Safari:
      </h2>
      <ol className="space-y-4">
        <Step n={1}>
          Tap the <strong>Share</strong> button <ShareIcon /> at the bottom of
          Safari
        </Step>
        <Step n={2}>
          Tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>
        </Step>
        <Step n={3}>
          Tap <strong>Add</strong>
        </Step>
      </ol>
    </div>
  );
}

// ---- Desktop ---------------------------------------------------

function DesktopInstructions() {
  const [installUrl, setInstallUrl] = useState("/install");

  useEffect(() => {
    setInstallUrl(window.location.origin + "/install");
  }, []);

  return (
    <div className="text-center py-4">
      <h2 className="font-sans font-black text-xl text-green-900 mb-2">
        Open on your phone
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Visit this page on your iPhone or Android phone to install LinkUp Golf.
      </p>
      <div className="bg-white rounded-xl border border-gray-100 p-4 text-sm text-gray-500 font-mono break-all">
        {installUrl}
      </div>
      <p className="mt-4 text-xs text-gray-400">
        Or scan a QR code if your admin provides one.
      </p>
    </div>
  );
}

// ---- Shared components -----------------------------------------

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <span
        className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ background: "#1A2E1A" }}
      >
        {n}
      </span>
      <span className="text-sm text-gray-700 pt-0.5">{children}</span>
    </li>
  );
}

// iOS Share icon SVG (matches the actual Safari share icon)
function ShareIcon() {
  return (
    <svg
      className="inline-block mx-0.5 align-text-bottom"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "#007AFF" }}
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}
