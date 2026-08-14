// Where a signed-in user should land when they have no member app to show.
//
// A non-member (a referral partner / host with no golf membership, so no home
// course) is sent to their workspace instead of the default landing page —
// there is nothing for them to book. Returns null if they own neither
// workspace (defensive — role sync provisions the row).

import type { createAdminClient } from '@/lib/supabase-server'

export async function workspaceLandingPath(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<string | null> {
  const { data: partner } = await admin
    .from('referral_partners').select('id').eq('member_id', userId).maybeSingle()
  if (partner) return '/partner'
  const { data: host } = await admin
    .from('hosts').select('id').eq('member_id', userId).eq('status', 'active').maybeSingle()
  if (host) return '/host'
  return null
}
