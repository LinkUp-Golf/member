import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// PostgREST refuses a bare `members(...)` embed when the parent table
// references members more than once — and several do (hosts: member_id +
// created_by; host_applications: member_id + reviewed_by; bookings: member_id +
// player_member_id). It's a runtime-only failure: types, lint, and the build
// all pass, and the request 500s the first time a real user hits the page.
// This shipped three separate times, so the rule is now absolute and enforced:
// inside the host module, every members embed names its foreign key.
//
//   bad:  member:members(first_name)
//   good: member:members!hosts_member_id_fkey(first_name)

const HOST_API_DIRS = [
  'src/app/api/host',
  'src/app/api/hosted-events',
  'src/app/api/admin/hosts',
  'src/app/api/admin/host-applications',
  'src/app/api/admin/hosted-events',
]

function routeFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return [] // directory removed — nothing to check
  }
  return entries.flatMap(entry => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

describe('host module PostgREST embeds', () => {
  const files = HOST_API_DIRS.flatMap(routeFiles)

  it('finds the host API routes', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('always names the foreign key when embedding members', () => {
    const offenders: string[] = []

    for (const file of files) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // Prose mentions members too ("Tell the released members (best-effort)"),
        // so strip comments before matching.
        const code = line.replace(/\/\/.*$/, '').trim()
        if (!code || code.startsWith('*') || code.startsWith('/*')) return

        // A members embed is `members(` or `members!fk(`. Only the unqualified
        // form is a bug. `from('members')` is not an embed.
        if (/\bmembers\s*\(/.test(code) && !/\bmembers\s*!/.test(code)) {
          offenders.push(`${file}:${i + 1}  ${code}`)
        }
      })
    }

    expect(offenders, `Unqualified members embed — name the FK (members!<table>_<column>_fkey):\n${offenders.join('\n')}`)
      .toEqual([])
  })
})
