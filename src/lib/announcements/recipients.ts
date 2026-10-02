// Who an announcement is emailed to.
//
// The post and the in-app notification always reach the whole community. The
// email does not: an admin says who gets it, either by GHL tag or by picking
// people, and nobody is emailed until they do. There is deliberately no "email
// everyone" — a broadcast to every address we hold is the send most likely to
// collect the complaints and bounces that cost us the sending domain, and the
// community already heard about the post on the channel built for that.
//
// Two ways of naming a group, and they're deliberately different in kind:
//
//   tags       a broad brush, resolved inside this community. "Whoever here
//              carries 'vip'" means the members of this course, because the
//              announcement belongs to the course and links to a feed only its
//              members can open.
//   memberIds  a deliberate choice of a named person, honoured as made. An
//              admin who picks someone knows who they picked, and silently
//              dropping them would be the more surprising behaviour.
//
// The tag half is pure and tested. Tags are matched case-insensitively, the
// same rule /admin/analytics uses and for the same reason: GHL applies its own
// case rules to a tag name and admins retype them by hand, so an exact match
// would make the audience depend on capitalisation nobody controls.

import type { createAdminClient } from '@/lib/supabase-server'
import { courseMemberIds } from '@/lib/push'
import { logger } from '@/lib/logger'

type AdminClient = ReturnType<typeof createAdminClient>

/** The choice an admin made, as stored on the announcement row. */
export interface EmailAudience {
  tags: string[]
  memberIds: string[]
}

/** Named nobody, so nobody is emailed. What an audience starts as. */
export const NOBODY: EmailAudience = { tags: [], memberIds: [] }

/**
 * Cleans a submitted audience: trimmed, de-duplicated, nothing empty.
 *
 * Tags keep the spelling they were given — that's what goes in the record and
 * what an admin reads back — and are compared normalised at match time.
 */
export function normaliseAudience(raw: {
  tags?: unknown
  memberIds?: unknown
}): EmailAudience {
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? Array.from(
          new Set(
            value
              .filter((v): v is string => typeof v === 'string')
              .map(v => v.trim())
              .filter(Boolean),
          ),
        )
      : []

  return { tags: strings(raw.tags), memberIds: strings(raw.memberIds) }
}

/**
 * Whether this audience names anyone at all.
 *
 * True means no email, not "email everyone". A row written before the audience
 * columns existed also reads as naming nobody — and that is the right answer
 * for it, since its email went out when it was published.
 */
export function namesNobody(audience: EmailAudience): boolean {
  return audience.tags.length === 0 && audience.memberIds.length === 0
}

/**
 * A member's GHL tags.
 *
 * members.ghl_tags is jsonb, so "an array of strings" is a convention rather
 * than a type. A row holding something else costs that member the tag match,
 * not the whole send.
 */
export function memberTags(row: { ghl_tags?: unknown }): string[] {
  return Array.isArray(row.ghl_tags)
    ? row.ghl_tags.filter((t): t is string => typeof t === 'string')
    : []
}

/** Which of these members carry at least one of the tags. Pure. */
export function membersCarryingAnyTag(
  rows: Array<{ id: string; ghl_tags?: unknown }>,
  tags: string[],
): string[] {
  const wanted = new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))
  if (wanted.size === 0) return []
  return rows
    .filter(row => memberTags(row).some(t => wanted.has(t.trim().toLowerCase())))
    .map(row => row.id)
}

/**
 * The member ids an audience resolves to — the exact list, never a stand-in for
 * "everyone".
 *
 * An empty array is a real answer and the caller must pass it through as one: an
 * audience that named nobody, and one that named a tag nobody carries, both come
 * out as "email no one". Handing null to notifyCourse would mean "the same
 * people the push reaches", which is the whole community, which is what this
 * exists to stop.
 */
export async function resolveEmailAudience(
  admin: AdminClient,
  courseId: string,
  audience: EmailAudience,
  excludeUserId?: string,
): Promise<string[]> {
  if (namesNobody(audience)) return []

  const ids = new Set<string>(audience.memberIds)

  if (audience.tags.length > 0) {
    // Only this community's active members: a tag is a segment, and the segment
    // that matters here is the one inside the course the announcement belongs
    // to. Named members are not filtered this way — see the note at the top.
    const courseIds = await courseMemberIds(courseId)
    if (courseIds.length > 0) {
      const { data, error } = await admin
        .from('members')
        .select('id, ghl_tags')
        .in('id', courseIds)

      if (error) {
        // Losing the tag half would quietly shrink the audience to whoever was
        // picked by name, which reads as "the tags matched nobody". Loud, and
        // the named members still get it.
        logger.error('Could not resolve announcement email tags', {
          action: 'announcement.audience_failed',
          errorCode: error.code,
          errorMessage: error.message,
          metadata: { courseId, tags: audience.tags.length },
        })
      } else {
        for (const id of membersCarryingAnyTag(data ?? [], audience.tags)) ids.add(id)
      }
    }
  }

  // The author doesn't need an email about their own announcement, the same way
  // they don't get the push.
  if (excludeUserId) ids.delete(excludeUserId)

  return Array.from(ids)
}
