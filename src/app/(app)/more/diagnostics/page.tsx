'use client'

// Sign-in diagnostics. Not linked from any menu: support asks a member to open
// /more/diagnostics and send back what it prints.
//
// The app keeps two views of who is signed in: the server's (the sb- cookies,
// read by the middleware and every API route) and the browser Supabase
// client's (read from the same cookies, held in memory, refreshed on a timer,
// guarded by a lock). When the two disagree, some screens work and others go
// blank — the profile was moved to the server for exactly that reason. This
// page tests each half live, with a time limit on every step so a stuck one
// reports "timed out" instead of hanging the page.
//
// It prints yes/no answers, timings, error messages and cookie *names* — never
// a token, a cookie's value or another member's data.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import AppShell from '@/components/layout/AppShell'

const STEP_TIMEOUT_MS = 8_000

type Outcome = { ms: number; result: string }

async function timed(work: () => Promise<string>): Promise<Outcome> {
  const start = performance.now()
  const elapsed = () => Math.round(performance.now() - start)
  try {
    const result = await Promise.race([
      work(),
      new Promise<string>(resolve =>
        setTimeout(() => resolve(`TIMED OUT after ${STEP_TIMEOUT_MS / 1000}s`), STEP_TIMEOUT_MS),
      ),
    ])
    return { ms: elapsed(), result }
  } catch (err) {
    return { ms: elapsed(), result: `THREW: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function runDiagnostics(): Promise<string[]> {
  const lines: string[] = []
  const add = (label: string, value: string) => lines.push(`${label}: ${value}`)
  const addOutcome = (label: string, o: Outcome) => add(label, `${o.result} (${o.ms} ms)`)

  add('Time', new Date().toISOString())
  add('Build', process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown')
  add('Installed app', window.matchMedia('(display-mode: standalone)').matches ? 'yes' : 'no (browser tab)')
  add('Browser', navigator.userAgent)

  // ---- Server's view (cookie) ----
  addOutcome('Server session', await timed(async () => {
    const res = await fetch('/api/members/me', { cache: 'no-store' })
    if (!res.ok) return `HTTP ${res.status}`
    const m = await res.json() as { email?: string; is_admin?: boolean }
    return `signed in as ${m.email}, is_admin=${m.is_admin}`
  }))

  // ---- Cookies (names and sizes only) ----
  const cookies = document.cookie ? document.cookie.split('; ') : []
  const sb = cookies.filter(c => c.startsWith('sb-'))
  add('Auth cookies visible to page', sb.length
    ? sb.map(c => `${c.split('=')[0]} (${c.length} chars)`).join(', ')
    : 'NONE')

  // ---- Browser client's view ----
  const supabase = createClient()

  addOutcome('Browser getSession', await timed(async () => {
    const { data, error } = await supabase.auth.getSession()
    if (error) return `error: ${error.message}`
    const s = data.session
    if (!s) return 'no session'
    const expiresIn = s.expires_at ? s.expires_at - Math.floor(Date.now() / 1000) : null
    return `session for ${s.user.email}, token expires in ${expiresIn}s`
  }))

  addOutcome('Browser getUser (asks Supabase)', await timed(async () => {
    const { data, error } = await supabase.auth.getUser()
    if (error) return `error: ${error.message}`
    return data.user ? `user ${data.user.email}` : 'no user'
  }))

  addOutcome('Browser data query', await timed(async () => {
    const { data, error } = await supabase.from('members').select('id, is_admin').limit(1)
    if (error) return `error: ${error.message}`
    return `ok, ${data?.length ?? 0} row(s)`
  }))

  // ---- Locks: a lock that is held and never released stalls every call above ----
  if ('locks' in navigator && navigator.locks?.query) {
    const o = await timed(async () => {
      const q = await navigator.locks.query()
      const fmt = (arr?: { name?: string }[]) => (arr ?? []).map(l => l.name).join(', ') || 'none'
      return `held: ${fmt(q.held)}; waiting: ${fmt(q.pending)}`
    })
    addOutcome('Locks', o)
  } else {
    add('Locks', 'not supported')
  }

  // ---- Offline copy ----
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations()
    add('Service worker', regs.length
      ? regs.map(r => `${r.active?.scriptURL ?? 'none active'}${r.waiting ? ' (update waiting)' : ''}`).join(', ')
      : 'none')
  }

  return lines
}

export default function DiagnosticsPage() {
  const [lines, setLines] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)

  const run = () => {
    setLines(null)
    setCopied(false)
    runDiagnostics().then(setLines)
  }

  // Run once on open; "Run again" repeats it.
  useEffect(() => { run() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const text = lines?.join('\n') ?? ''

  return (
    <AppShell title="Diagnostics" description="Sign-in checks for support">
      <div className="px-5 py-5 space-y-4">
        <p className="text-sm" style={{ color: 'rgba(0,38,105,0.6)' }}>
          This checks how this device is signed in. It shows no passwords or
          login contents. Copy the results and send them to support.
        </p>

        {lines === null ? (
          <p className="text-sm">Running checks… this can take up to 30 seconds.</p>
        ) : (
          <pre className="text-xs whitespace-pre-wrap break-words bg-white rounded-xl p-4 border" style={{ borderColor: 'rgba(0,38,105,0.1)' }}>
            {text}
          </pre>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            disabled={lines === null}
            onClick={() => {
              navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {})
            }}
            className="focus-ring px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--color-gold)', color: 'var(--color-green-950)' }}
          >
            {copied ? 'Copied' : 'Copy results'}
          </button>
          <button
            type="button"
            disabled={lines === null}
            onClick={run}
            className="focus-ring px-4 py-2.5 rounded-xl text-sm font-semibold border disabled:opacity-50"
            style={{ borderColor: 'rgba(0,38,105,0.15)', color: 'var(--color-green-900)' }}
          >
            Run again
          </button>
        </div>
      </div>
    </AppShell>
  )
}
