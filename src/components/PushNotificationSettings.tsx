'use client'

// ============================================================
// <PushNotificationSettings />
//
// Drop-in component for managing push notification opt-in.
// Uses usePushNotifications() — no additional state needed.
//
// Usage:
//   import { PushNotificationSettings } from '@/components/PushNotificationSettings'
//   <PushNotificationSettings />
// ============================================================

import { useState, useCallback } from 'react'
import { usePushNotifications }  from '@/hooks/usePushNotifications'
import { cn }                    from '@/lib/utils'

// ---- Toast --------------------------------------------------

interface ToastState {
  message: string
  type:    'success' | 'error' | 'info'
}

function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  const show = useCallback((message: string, type: ToastState['type'] = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  return { toast, show }
}

// ---- Permission badge ---------------------------------------

function PermissionBadge({ permission }: { permission: string }) {
  const configs: Record<string, { label: string; className: string }> = {
    granted:     { label: 'Allowed',      className: 'bg-green-100 text-green-800' },
    denied:      { label: 'Blocked',      className: 'bg-red-100 text-red-800' },
    default:     { label: 'Not set',      className: 'bg-gray-100 text-gray-600' },
    unsupported: { label: 'Unsupported',  className: 'bg-yellow-100 text-yellow-700' },
  }
  const config = configs[permission] ?? configs['default']!

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className
      )}
    >
      {config.label}
    </span>
  )
}

// ---- Main component -----------------------------------------

export function PushNotificationSettings() {
  const {
    permission,
    isSupported,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
    sendTestNotification,
  } = usePushNotifications()

  const { toast, show } = useToast()

  // ---- Handlers -------------------------------------------

  async function handleEnable() {
    const ok = await subscribe()
    if (ok) {
      show('Notifications enabled! You\'ll be notified about activity in your community.', 'success')
    } else if (permission === 'denied') {
      show(
        'Notifications are blocked. Open your browser\'s site settings to allow them.',
        'error'
      )
    } else {
      show('Could not enable notifications. Please try again.', 'error')
    }
  }

  async function handleDisable() {
    await unsubscribe()
    show('Notifications disabled.', 'info')
  }

  async function handleTest() {
    const ok = await sendTestNotification()
    if (ok) {
      show('Test notification sent! Check your notification tray.', 'success')
    } else {
      show('Could not send test notification. Make sure notifications are enabled.', 'error')
    }
  }

  // ---- Not supported ----------------------------------------

  if (!isSupported) {
    return (
      <div
        className="rounded-xl border border-gray-200 bg-white p-4"
        role="region"
        aria-label="Push notifications"
      >
        <div className="flex items-start gap-3">
          <BellOffIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-900">
              Push notifications not supported
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Your browser doesn't support push notifications. Try Chrome, Edge, or
              Samsung Internet on Android.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ---- Denied -----------------------------------------------

  const isDenied = permission === 'denied'

  // ---- Render -----------------------------------------------

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white"
      role="region"
      aria-label="Push notification settings"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <BellIcon className="h-5 w-5 text-[#1A2E1A]" />
          <span className="text-sm font-semibold text-gray-900">Push Notifications</span>
        </div>
        <PermissionBadge permission={permission} />
      </div>

      {/* Body */}
      <div className="px-4 py-4 space-y-4">
        {/* Status description */}
        <p className="text-xs text-gray-500 leading-relaxed">
          {isSubscribed
            ? 'You\'ll receive notifications about new members, tee time bookings, messages, and upcoming Focus LinkUps.'
            : isDenied
              ? 'Notifications are blocked by your browser. To re-enable, open your browser\'s site settings and allow notifications for this site.'
              : 'Enable notifications to stay in the loop with your golf community.'}
        </p>

        {/* Primary action */}
        {!isDenied && (
          <div className="flex flex-wrap items-center gap-2">
            {isSubscribed ? (
              <button
                onClick={handleDisable}
                disabled={isLoading}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border border-gray-300',
                  'bg-white px-3 py-2 text-sm font-medium text-gray-700',
                  'transition-colors hover:bg-gray-50 focus-visible:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-[#1A2E1A] focus-visible:ring-offset-2',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
                aria-busy={isLoading}
              >
                {isLoading
                  ? <Spinner className="h-4 w-4" />
                  : <BellOffIcon className="h-4 w-4" />}
                {isLoading ? 'Disabling…' : 'Disable notifications'}
              </button>
            ) : (
              <button
                onClick={handleEnable}
                disabled={isLoading}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg',
                  'bg-[#1A2E1A] px-3 py-2 text-sm font-medium text-white',
                  'transition-colors hover:bg-[#243d24] focus-visible:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-[#1A2E1A] focus-visible:ring-offset-2',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
                aria-busy={isLoading}
              >
                {isLoading
                  ? <Spinner className="h-4 w-4 text-white" />
                  : <BellIcon className="h-4 w-4" />}
                {isLoading ? 'Enabling…' : 'Enable notifications'}
              </button>
            )}

            {/* Test notification button — only when subscribed */}
            {isSubscribed && (
              <button
                onClick={handleTest}
                disabled={isLoading}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg border border-gray-300',
                  'bg-white px-3 py-2 text-sm font-medium text-gray-700',
                  'transition-colors hover:bg-gray-50 focus-visible:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-[#1A2E1A] focus-visible:ring-offset-2',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
                aria-label="Send a test notification"
                aria-busy={isLoading}
              >
                {isLoading ? <Spinner className="h-4 w-4" /> : <TestIcon className="h-4 w-4" />}
                Test
              </button>
            )}
          </div>
        )}

        {/* Denied guidance */}
        {isDenied && (
          <a
            href="https://support.google.com/chrome/answer/3220216"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1.5 text-xs text-[#1A2E1A] underline',
              'hover:text-[#243d24] focus-visible:outline-none',
              'focus-visible:ring-2 focus-visible:ring-[#1A2E1A] rounded'
            )}
          >
            How to unblock notifications
            <ExternalLinkIcon className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'mx-4 mb-4 rounded-lg px-3 py-2 text-xs font-medium',
            toast.type === 'success' && 'bg-green-50 text-green-800',
            toast.type === 'error'   && 'bg-red-50 text-red-800',
            toast.type === 'info'    && 'bg-blue-50 text-blue-800'
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}

// ---- Inline icons -------------------------------------------
// Keeping icons inline avoids adding a dependency just for this component.

function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function BellOffIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function TestIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
