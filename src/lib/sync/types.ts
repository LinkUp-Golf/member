import type { SupabaseClient } from '@supabase/supabase-js'
import type { GHLContact } from '@/types'

export interface SyncContext {
  /** Admin Supabase client (service role — bypasses RLS) */
  supabase: SupabaseClient
  /** Supabase auth user ID. Required when syncing a specific member. */
  userId?: string
  /** Optional request ID for tracing logs across the sync operation. */
  requestId?: string
}

export interface SyncResult {
  success: boolean
  userId?: string
  action: 'created' | 'updated' | 'skipped' | 'deactivated'
  error?: string
}

export interface BulkSyncResult {
  total: number
  synced: number
  failed: number
  errors: string[]
}

export interface MemberSyncInput {
  contact: GHLContact
  userId: string
  ctx: SyncContext
}
