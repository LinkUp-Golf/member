// Loads what src/lib/communities/permissions.ts needs to know about a member:
// which communities they captain and which venues they're an approved host at.
// Server-only (service-role client), called behind withAuth.
//
// Fails closed: a read that errors gives the member no Captain or Host rights
// rather than guessing. Admin rights come from members.is_admin, already
// checked by withAuth, so an admin is never locked out by this.

import type { createAdminClient } from '@/lib/supabase-server'
import type { Actor } from './permissions'
import { logger } from '@/lib/logger'

type AdminClient = ReturnType<typeof createAdminClient>

export async function loadActor(admin: AdminClient, memberId: string, isAdmin: boolean): Promise<Actor> {
  const [captained, hosted] = await Promise.all([
    admin.from('communities').select('id').eq('captain_member_id', memberId).eq('active', true),
    admin
      .from('host_venues')
      .select('course_id, hosts!inner(member_id)')
      .eq('hosts.member_id', memberId)
      .eq('status', 'approved'),
  ])

  if (captained.error || hosted.error) {
    logger.error('communities: failed to load roles', {
      action: 'communities.load_actor',
      metadata: { member_id: memberId },
      errorMessage: captained.error?.message ?? hosted.error?.message,
    })
  }

  return {
    memberId,
    isAdmin,
    captainOf: captained.error ? [] : (captained.data ?? []).map(r => r.id as string),
    hostVenueIds: hosted.error ? [] : (hosted.data ?? []).map(r => r.course_id as string),
  }
}
