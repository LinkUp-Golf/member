import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { validateEmail, validateString } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())

  const { data, error } = await supabase
    .from('referrals')
    .select('*')
    .eq('referring_member_id', ctx.userId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
})

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const body = await req.json() as Record<string, unknown>

  const emailCheck = validateEmail(body.email)
  const nameCheck = validateString(body.name, 'name', { min: 2, max: 100 })

  if (!emailCheck.valid) return NextResponse.json({ error: emailCheck.errors[0] }, { status: 400 })
  if (!nameCheck.valid) return NextResponse.json({ error: nameCheck.errors[0] }, { status: 400 })

  const { data, error } = await supabase
    .from('referrals')
    .insert({
      referring_member_id: ctx.userId,
      referred_email: (body.email as string).toLowerCase().trim(),
      status: 'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
})
