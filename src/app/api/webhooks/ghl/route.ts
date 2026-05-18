// ============================================================
// POST /api/webhooks/ghl
// Receives GHL webhooks for contact tag changes.
// Updates member access status in real time when tags are
// added or removed in GHL (e.g. membership cancellation).
// Secured by webhook secret header.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getContactById } from '@/lib/ghl'
import { COURSE_TAG_MAP } from '@/lib/ghl-tags'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  // Verify webhook signature
  const signature = request.headers.get('x-ghl-signature')
  const body = await request.text()

  if (!verifyWebhookSignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: {
    type: string
    contactId: string
    tags?: string[]
    addedTags?: string[]
    removedTags?: string[]
  }

  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Handle tag change events
  if (
    payload.type === 'contact.tag.added' ||
    payload.type === 'contact.tag.removed'
  ) {
    await handleTagChange(payload.contactId, payload.type)
  }

  return NextResponse.json({ received: true })
}

// ---- Webhook signature verification -------------------------

function verifyWebhookSignature(body: string, signature: string | null): boolean {
  if (!signature || !process.env.GHL_WEBHOOK_SECRET) return false

  const expected = crypto
    .createHmac('sha256', process.env.GHL_WEBHOOK_SECRET)
    .update(body)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}

// ---- Handle tag changes -------------------------------------

async function handleTagChange(contactId: string, eventType: string) {
  const adminSupabase = createAdminClient()

  // Get fresh contact data from GHL
  const contact = await getContactById(contactId)
  if (!contact) return

  // Find the member in Supabase by GHL contact ID
  const { data: member } = await adminSupabase
    .from('members')
    .select('id, home_course_id')
    .eq('ghl_contact_id', contactId)
    .single()

  if (!member) return

  // Update their GHL tags in Supabase
  await adminSupabase
    .from('members')
    .update({
      ghl_tags: contact.tags ?? [],
      updated_at: new Date().toISOString(),
    })
    .eq('id', member.id)

  // Update course membership statuses based on current tags
  for (const [tag, courseSlug] of Object.entries(COURSE_TAG_MAP)) {
    const { data: course } = await adminSupabase
      .from('courses')
      .select('id')
      .eq('slug', courseSlug)
      .single()

    if (!course) continue

    const hasTag = contact.tags?.includes(tag) ?? false

    if (hasTag) {
      // Ensure active membership exists
      await adminSupabase
        .from('course_memberships')
        .upsert({
          member_id: member.id,
          course_id: course.id,
          access_type: course.id === member.home_course_id ? 'home' : 'guest',
          status: 'active',
        }, {
          onConflict: 'member_id,course_id,access_type',
        })

      // Update membership status
      await adminSupabase
        .from('members')
        .update({ membership_status: 'active' })
        .eq('id', member.id)
    } else {
      // Deactivate membership for this course
      await adminSupabase
        .from('course_memberships')
        .update({ status: 'expired' })
        .eq('member_id', member.id)
        .eq('course_id', course.id)

      // If this was their home course, mark as cancelled
      if (course.id === member.home_course_id) {
        await adminSupabase
          .from('members')
          .update({ membership_status: 'cancelled' })
          .eq('id', member.id)
      }
    }
  }
}
