// ============================================================
// Subscription repository
//
// All Supabase queries for push_subscriptions live here.
// Uses the admin client (bypasses RLS) so API routes and
// server utilities can read/write any row.  The admin client
// is never exposed to the browser.
// ============================================================

import { createAdminClient } from '@/lib/supabase-server'
import type { PushSubscriptionRow, SubscribeBody } from './types'

// ---- Upsert -------------------------------------------------
// Idempotent: if the endpoint already exists we update its keys
// and associate the latest user_id.  This handles browser
// reinstalls (same endpoint, new keys) and login after an
// anonymous subscription.

export async function upsertSubscription(
  body: SubscribeBody,
  userId: string | null
): Promise<PushSubscriptionRow> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id:    userId,
        endpoint:   body.endpoint,
        p256dh:     body.keys.p256dh,
        auth:       body.keys.auth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    )
    .select()
    .single()

  if (error) throw new Error(`upsertSubscription: ${error.message}`)
  return data as PushSubscriptionRow
}

// ---- Delete by endpoint + owner ----------------------------
// RLS would enforce this; the admin client does an extra
// user_id guard so the route can call it without a Supabase
// session.

export async function deleteSubscription(
  endpoint: string,
  userId: string
): Promise<void> {
  const supabase = createAdminClient()

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id',  userId)
}

// ---- Claim anonymous subscriptions after login -------------
// When a user logs in we associate any subscriptions that were
// stored with user_id = null for the same endpoint(s).

export async function claimAnonymousSubscriptions(
  endpoints: string[],
  userId: string
): Promise<void> {
  if (!endpoints.length) return
  const supabase = createAdminClient()

  await supabase
    .from('push_subscriptions')
    .update({ user_id: userId, updated_at: new Date().toISOString() })
    .in('endpoint', endpoints)
    .is('user_id', null)
}

// ---- Find by user_id ---------------------------------------

export async function findByUserId(
  userId: string
): Promise<PushSubscriptionRow[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, created_at, updated_at')
    .eq('user_id', userId)

  if (error) throw new Error(`findByUserId: ${error.message}`)
  return (data ?? []) as PushSubscriptionRow[]
}

// ---- Find all (send-to-all) ---------------------------------

export async function findAll(): Promise<PushSubscriptionRow[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, created_at, updated_at')

  if (error) throw new Error(`findAll: ${error.message}`)
  return (data ?? []) as PushSubscriptionRow[]
}

// ---- Find all for a set of member_ids ----------------------
// Used by the existing push.ts helpers that target specific
// members (e.g. sendPushToCourse).

export async function findByUserIds(
  userIds: string[]
): Promise<PushSubscriptionRow[]> {
  if (!userIds.length) return []
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, created_at, updated_at')
    .in('user_id', userIds)

  if (error) throw new Error(`findByUserIds: ${error.message}`)
  return (data ?? []) as PushSubscriptionRow[]
}

// ---- Delete stale (404 / 410) subscriptions ----------------

export async function deleteStaleEndpoints(
  endpoints: string[]
): Promise<void> {
  if (!endpoints.length) return
  const supabase = createAdminClient()

  await supabase
    .from('push_subscriptions')
    .delete()
    .in('endpoint', endpoints)
}
