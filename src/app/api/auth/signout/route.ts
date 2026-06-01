export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@/lib/supabase-server'

export async function POST() {
  const supabase = createRouteHandlerClient(cookies())
  await supabase.auth.signOut()

  const res = NextResponse.json({ ok: true })
  // Belt-and-suspenders: expire all sb- cookies in the response
  const cookieStore = cookies()
  cookieStore.getAll()
    .filter(c => c.name.startsWith('sb-'))
    .forEach(c => res.cookies.set(c.name, '', { maxAge: 0, path: '/' }))

  return res
}
