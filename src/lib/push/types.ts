// ============================================================
// Push notification — shared types
// Used by API routes, the service, the repository, and the hook.
// ============================================================

// ---- Database row -------------------------------------------

export interface PushSubscriptionRow {
  id: string
  user_id: string | null
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
  updated_at: string
}

// ---- Notification payload -----------------------------------

export interface NotificationAction {
  action: string
  title: string
  icon?: string
}

export interface PushPayload {
  title: string
  body: string
  /** Relative path to notification icon. Defaults to /icons/icon-192.png */
  icon?: string
  /** Relative path to badge icon shown in system tray */
  badge?: string
  /** Large image displayed inside the notification */
  image?: string
  /** Deduplication tag — replaces an existing notification with the same tag */
  tag?: string
  /** URL to open when the notification is tapped. Put inside data.url */
  url?: string
  /** Custom key→value data passed through to the service worker */
  data?: Record<string, unknown>
  /** Up to 2 action buttons (Chrome/Android) */
  actions?: NotificationAction[]
  /** Keep notification visible until the user interacts */
  requireInteraction?: boolean
  /** Vibration pattern in ms: [vibrate, pause, vibrate, ...] */
  vibrate?: number[]
}

// ---- Send result --------------------------------------------

export interface SendResult {
  sent: number
  failed: number
  cleaned: number   // stale subscriptions removed
}

// ---- API payloads (validated at route layer) ----------------

export interface SubscribeBody {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export interface UnsubscribeBody {
  endpoint: string
}

export interface SendBody {
  endpoint: string
  p256dh: string
  auth: string
  notification: PushPayload
}

export interface SendToUserBody {
  userId: string
  notification: PushPayload
}

export interface SendToAllBody {
  notification: PushPayload
}

// ---- Validation result (mirrors existing validation.ts) -----

export interface ValidationResult {
  valid: boolean
  errors: string[]
}
