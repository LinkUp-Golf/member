import type { createAdminClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { COURSE_ANN_NS, courseAnnPrefix } from '@/lib/cache/keys'
import type { AnnouncementType } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

interface AnnouncementContent {
  type: AnnouncementType
  authorId: string
  title: string
  body: string
  image_url?: string | null
  video_url?: string | null
  media_urls?: string[]
  metadata?: Record<string, unknown>
}

// Courses that are live and should receive system-generated announcements
// (new course / promotion notices). `excludeId` skips a course with no
// members yet (e.g. the course that was just created).
export async function activeCourseIds(admin: AdminClient, excludeId?: string): Promise<string[]> {
  let query = admin.from('courses').select('id').eq('active', true).eq('approval_status', 'active')
  if (excludeId) query = query.neq('id', excludeId)
  const { data } = await query
  return (data ?? []).map((c: { id: string }) => c.id)
}

// Inserts one published announcement per course and busts each course's
// announcement cache. Used for content that can be global (course_id null)
// at the source (promotions, courses) but must land as a per-course row here
// since `announcements.course_id` is NOT NULL and RLS scopes reads by course.
export async function postAnnouncementToCourses(
  admin: AdminClient,
  courseIds: string[],
  content: AnnouncementContent
) {
  if (!courseIds.length) return

  const publishedAt = new Date().toISOString()
  const rows = courseIds.map(courseId => ({
    course_id: courseId,
    author_id: content.authorId,
    type: content.type,
    title: content.title,
    body: content.body,
    image_url: content.image_url ?? null,
    video_url: content.video_url ?? null,
    media_urls: content.media_urls ?? [],
    metadata: content.metadata ?? {},
    status: 'published',
    published_at: publishedAt,
  }))

  await admin.from('announcements').insert(rows)
  await Promise.all(
    courseIds.map(courseId =>
      getCache(COURSE_ANN_NS).clear(courseAnnPrefix(courseId)).catch(() => {})
    )
  )
}
