// A member's private fields — gender and date of birth — read and written
// through the service role. They live in member_match_profiles (RLS on, no
// policies), so no other member can read them and they're used only for
// matching.
//
// A member can set them on their profile before ever turning Curated
// Introductions on. The row that creates is inserted with
// open_to_suggestions = false and no completed_at, so it reads exactly as
// "never turned on": the column's default is true, and leaning on it would
// put a member into the matching pool by saving their birthday.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isStoredGender, type StoredGender } from '@/lib/ghl/profile-fields'

export interface PrivateFields {
  gender: StoredGender | null
  date_of_birth: string | null
  dob_prefer_not: boolean
}

export const EMPTY_PRIVATE_FIELDS: PrivateFields = { gender: null, date_of_birth: null, dob_prefer_not: false }

export async function loadPrivateFields(admin: SupabaseClient, memberId: string): Promise<PrivateFields> {
  const { data, error } = await admin
    .from('member_match_profiles')
    .select('gender, date_of_birth, dob_prefer_not')
    .eq('member_id', memberId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { ...EMPTY_PRIVATE_FIELDS }
  return {
    gender: isStoredGender(data.gender) ? data.gender : null,
    date_of_birth: typeof data.date_of_birth === 'string' ? data.date_of_birth : null,
    dob_prefer_not: data.dob_prefer_not === true,
  }
}

export async function savePrivateFields(
  admin: SupabaseClient,
  memberId: string,
  fields: Partial<PrivateFields>,
): Promise<void> {
  if (Object.keys(fields).length === 0) return
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('member_match_profiles')
    .update({ ...fields, updated_at: now })
    .eq('member_id', memberId)
    .select('member_id')
  if (error) throw new Error(error.message)
  if (data && data.length > 0) return

  const { error: insertError } = await admin
    .from('member_match_profiles')
    .insert({ member_id: memberId, ...fields, open_to_suggestions: false, updated_at: now })
  // Lost a race with another write creating the row: update the row it made.
  if (insertError?.code === '23505') {
    const { error: retryError } = await admin
      .from('member_match_profiles')
      .update({ ...fields, updated_at: now })
      .eq('member_id', memberId)
    if (retryError) throw new Error(retryError.message)
    return
  }
  if (insertError) throw new Error(insertError.message)
}
