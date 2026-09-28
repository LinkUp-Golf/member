import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Every notification template should be sent by something.
//
// A template with no call site is a notification nobody ever receives, and
// nothing complains: it type-checks, it renders, it is simply never reached.
// Eight of them had accumulated that way — some because the cron that sent
// them was deleted, some because they were written before the flow that would
// have used them. This pins the ones that are wired so the set can only
// shrink deliberately, and names the ones that aren't so the list stays
// honest rather than quietly growing.

const SRC = join(process.cwd(), 'src')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.tsx?$/.test(entry) ? [full] : []
  })
}

const callSites = walk(SRC)
  .filter(f => !f.includes('__tests__') && !f.endsWith(join('lib', 'push.ts')))
  .map(f => readFileSync(f, 'utf8'))
  .join('\n')

const templateNames = (() => {
  const src = readFileSync(join(SRC, 'lib', 'push.ts'), 'utf8')
  const body = src.slice(src.indexOf('export const NotificationTemplates'))
  return [...body.matchAll(/^ {2}([a-zA-Z]+):/gm)].map(m => m[1] as string)
})()

/**
 * Templates with no sender, and why each is accepted for now. Removing a name
 * from this list is the point: it should only ever get shorter.
 */
const KNOWN_UNSENT: Record<string, string> = {
  // Their cron routes were deliberately deleted; CLAUDE.md says to reintroduce
  // the functionality fresh rather than resurrect them.
  focusLinkup: 'cron/daily was removed',
  playSuggestion: 'cron/play-suggestions was removed',
  // No approval flow exists — the admin route only revokes, expires, extends.
  guestAccessApproved: 'no guest-access approval endpoint',
  // Community broadcasts: written, but nobody decided who receives them.
  newMember: 'no call site; audience undecided',
  bookingAnnouncement: 'no call site; audience undecided',
  visitingMember: 'no call site; audience undecided',
  referralJoined: 'no referral-conversion hook',
  // Superseded by hostedEventApproved, which admin/hosted-events sends.
  hostedEventPublished: 'superseded by hostedEventApproved',
}

describe('notification coverage', () => {
  it('finds the templates', () => {
    expect(templateNames.length).toBeGreaterThan(30)
  })

  it('every template is either sent by something or listed as unsent', () => {
    const orphans = templateNames.filter(
      name => !callSites.includes(`NotificationTemplates.${name}`) && !(name in KNOWN_UNSENT),
    )
    expect(orphans).toEqual([])
  })

  it('nothing on the unsent list has quietly been wired up', () => {
    // If one gets a call site, take it off the list rather than leaving a
    // stale excuse behind.
    const nowSent = Object.keys(KNOWN_UNSENT).filter(name =>
      callSites.includes(`NotificationTemplates.${name}`),
    )
    expect(nowSent).toEqual([])
  })
})
