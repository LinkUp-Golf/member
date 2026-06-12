// ============================================================
// Push service
//
// Core send logic: builds the notification payload, dispatches
// to web-push with exponential-backoff retries, and cleans up
// any subscriptions the push service reports as expired.
//
// Server-only. Never import in client components.
// ============================================================

import { getWebPush } from './webPush'
import {
  findByUserId,
  findByUserIds,
  findAll,
  deleteStaleEndpoints,
} from './subscriptionRepository'
import type { PushPayload, SendResult, PushSubscriptionRow } from './types'
import { createAdminClient } from '@/lib/supabase-server'
import type { NotificationType } from '@/types'

// ---- Retry configuration ------------------------------------

const MAX_RETRIES  = 3
const BASE_DELAY   = 500   // ms; doubles each attempt (500 → 1000 → 2000)

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      // 404 / 410 are permanent failures; no point retrying
      const code = (err as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) throw err
      if (attempt < retries) {
        await delay(BASE_DELAY * Math.pow(2, attempt))
      }
    }
  }
  throw lastError
}

// ---- Payload serialisation ----------------------------------

const MAX_TITLE  = 100
const MAX_BODY   = 300
const MAX_ACTION = 50

function sanitise(text: string, maxLen: number): string {
  // Strip angle brackets to prevent reflected-HTML injection in
  // notifications that render body as text but log it as HTML.
  return text.replace(/[<>"']/g, '').trim().slice(0, maxLen)
}

function serialise(payload: PushPayload): string {
  return JSON.stringify({
    title:             sanitise(payload.title, MAX_TITLE),
    body:              sanitise(payload.body,  MAX_BODY),
    icon:              payload.icon    ?? '/icons/icon-192.png',
    badge:             payload.badge   ?? '/icons/icon-192.png',
    image:             payload.image,
    tag:               payload.tag,
    requireInteraction: payload.requireInteraction ?? false,
    vibrate:           payload.vibrate,
    data: {
      url: payload.url ?? '/',
      ...(payload.data ?? {}),
    },
    actions: payload.actions
      ?.slice(0, 2)
      .map(a => ({
        action: a.action,
        title:  sanitise(a.title, MAX_ACTION),
        icon:   a.icon,
      })),
  })
}

// ---- Core dispatch ------------------------------------------

async function dispatchToSubscriptions(
  subscriptions: PushSubscriptionRow[],
  payload: PushPayload
): Promise<SendResult> {
  if (!subscriptions.length) return { sent: 0, failed: 0, cleaned: 0 }

  const wp              = getWebPush()
  const notification    = serialise(payload)
  const staleEndpoints: string[] = []
  let sent   = 0
  let failed = 0

  await Promise.allSettled(
    subscriptions.map(async sub => {
      try {
        await withRetry(() =>
          wp.sendNotification(
            {
              endpoint: sub.endpoint,
              keys:     { p256dh: sub.p256dh, auth: sub.auth },
            },
            notification,
            {
              TTL:     86_400,  // 1 day
              urgency: 'normal',
            }
          )
        )
        sent++
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) {
          // Push service reports subscription is gone; schedule removal.
          staleEndpoints.push(sub.endpoint)
        }
        failed++
        console.warn(
          `[push] send failed endpoint=${sub.endpoint.slice(0, 40)} ` +
          `status=${code ?? 'network'}`
        )
      }
    })
  )

  // Clean stale records asynchronously (non-blocking for caller)
  if (staleEndpoints.length) {
    deleteStaleEndpoints(staleEndpoints).catch(e =>
      console.error('[push] cleanup failed', e)
    )
  }

  const cleaned = staleEndpoints.length
  console.info(`[push] sent=${sent} failed=${failed} cleaned=${cleaned}`)
  return { sent, failed, cleaned }
}

// ---- Notification log helper --------------------------------

const TAG_TYPE_MAP: Record<string, NotificationType> = {
  'new-member':    'new_member',
  'booking':       'booking',
  'visit':         'visiting_member',
  'msg':           'message',
  'focus-linkup':  'focus_linkup',
  'suggestion':    'play_suggestion',
  'guest-access':  'guest_access',
  'referral':      'referral',
  'test-notification': 'test',
}

function tagToType(tag?: string): NotificationType {
  if (!tag) return 'general'
  for (const [prefix, type] of Object.entries(TAG_TYPE_MAP)) {
    if (tag === prefix || tag.startsWith(`${prefix}-`)) return type
  }
  return 'general'
}

async function logNotifications(memberIds: string[], payload: PushPayload): Promise<void> {
  if (!memberIds.length) return
  const admin = createAdminClient()
  await admin.from('notification_log').insert(
    memberIds.map(id => ({
      member_id: id,
      type:      tagToType(payload.tag),
      title:     payload.title.slice(0, 255),
      body:      payload.body.slice(0, 500),
      data:      payload.data ?? null,
      url:       payload.url ?? null,
    }))
  )
}

// ---- Public API ---------------------------------------------

/** Send to all subscriptions for a single user */
export async function sendToUser(
  userId: string,
  payload: PushPayload
): Promise<SendResult> {
  // Log before dispatch so the history entry exists even if push isn't enabled
  logNotifications([userId], payload).catch(e =>
    console.warn('[push] notification log failed', e)
  )
  const subs = await findByUserId(userId)
  return dispatchToSubscriptions(subs, payload)
}

/** Send to all subscriptions for a set of users */
export async function sendToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<SendResult> {
  if (!userIds.length) return { sent: 0, failed: 0, cleaned: 0 }
  logNotifications(userIds, payload).catch(e =>
    console.warn('[push] notification log failed', e)
  )
  const subs = await findByUserIds(userIds)
  return dispatchToSubscriptions(subs, payload)
}

/** Send to every subscription in the database */
export async function sendToAll(
  payload: PushPayload
): Promise<SendResult> {
  const subs = await findAll()
  return dispatchToSubscriptions(subs, payload)
}

/** Send to one specific subscription (used by /api/push/send) */
export async function sendToSubscription(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: PushPayload
): Promise<SendResult> {
  return dispatchToSubscriptions(
    [{ id: '', user_id: null, endpoint, p256dh, auth, created_at: '', updated_at: '' }],
    payload
  )
}

/** Send a test notification to a single subscription */
export async function sendTestNotification(
  endpoint: string,
  p256dh: string,
  auth: string
): Promise<SendResult> {
  return sendToSubscription(endpoint, p256dh, auth, {
    title:   'LinkUp Golf — notifications enabled',
    body:    'You\'ll now receive updates from your golf community.',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/icon-192.png',
    tag:     'test-notification',
    url:     '/home',
    vibrate: [200, 100, 200],
  })
}
