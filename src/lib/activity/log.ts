// ============================================================
// Server-side activity recording.
//
// Fire-and-forget by design: analytics must never break, slow or
// fail the request that produced it. Every call site uses
// `void logActivity(...)` and this function swallows its own
// errors.
//
// Server-only — NEVER import this file in a Client Component.
// ============================================================

import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import { ACTIVITY_ACTIONS, type ActivityAction } from './areas'

export interface LogActivityInput {
  memberId: string
  action: ActivityAction
  /** Home course at the time — stamped on the row so the report keeps
   *  grouping correctly after a member moves course. */
  courseId?: string | null
  targetId?: string | null
  targetLabel?: string | null
  path?: string | null
  metadata?: Record<string, unknown>
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  const spec = ACTIVITY_ACTIONS[input.action]
  if (!spec) return

  try {
    // Service role: RLS on member_activity_events has no insert policy, and
    // member_id must come from the authenticated session rather than the body.
    const { error } = await createAdminClient()
      .from('member_activity_events')
      .insert({
        member_id:    input.memberId,
        course_id:    input.courseId ?? null,
        area:         spec.area,
        action:       input.action,
        kind:         spec.kind,
        target_id:    input.targetId ?? null,
        target_label: input.targetLabel ?? null,
        path:         input.path ?? null,
        metadata:     input.metadata ?? {},
      })

    if (error) {
      logger.warn('Activity event not recorded', {
        action: 'activity.log',
        errorMessage: error.message,
        metadata: { activity: input.action },
      })
    }
  } catch (err) {
    logger.warn('Activity event not recorded', {
      action: 'activity.log',
      errorMessage: err instanceof Error ? err.message : String(err),
      metadata: { activity: input.action },
    })
  }
}
