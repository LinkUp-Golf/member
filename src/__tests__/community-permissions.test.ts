import { describe, it, expect } from 'vitest'
import {
  adminScope,
  canApproveHostAt,
  canApproveVenue,
  canManageCommunity,
  canManageEventsAt,
  canOpenAdmin,
  venuesForEvents,
  withinScope,
  type Actor,
} from '@/lib/communities/permissions'

const SD = 'san-diego'
const LA = 'los-angeles'
const aviara = { id: 'aviara', community_id: SD }
const torrey = { id: 'torrey', community_id: SD }
const riviera = { id: 'riviera', community_id: LA }
const orphan = { id: 'orphan', community_id: null }

const admin: Actor = { memberId: 'a', isAdmin: true, captainOf: [], hostVenueIds: [] }
const captain: Actor = { memberId: 'greg', isAdmin: false, captainOf: [SD], hostVenueIds: [] }
const host: Actor = { memberId: 'jim', isAdmin: false, captainOf: [], hostVenueIds: ['aviara'] }
const member: Actor = { memberId: 'm', isAdmin: false, captainOf: [], hostVenueIds: [] }

describe('admins', () => {
  it('act in every community, at every venue', () => {
    for (const v of [aviara, riviera, orphan]) {
      expect(canManageEventsAt(admin, v)).toBe(true)
      expect(canApproveVenue(admin, v)).toBe(true)
      expect(canApproveHostAt(admin, v)).toBe(true)
    }
    expect(adminScope(admin)).toBe('all')
  })
})

describe('a Captain', () => {
  it('runs their own community and no other', () => {
    expect(canManageCommunity(captain, SD)).toBe(true)
    expect(canManageCommunity(captain, LA)).toBe(false)
    expect(canManageCommunity(captain, null)).toBe(false)
  })

  it('manages events at any of its venues, and approves its venues and hosts', () => {
    expect(canManageEventsAt(captain, aviara)).toBe(true)
    expect(canManageEventsAt(captain, torrey)).toBe(true)
    expect(canApproveVenue(captain, torrey)).toBe(true)
    expect(canApproveHostAt(captain, aviara)).toBe(true)
  })

  it('does nothing in another community', () => {
    expect(canManageEventsAt(captain, riviera)).toBe(false)
    expect(canApproveVenue(captain, riviera)).toBe(false)
    expect(canApproveHostAt(captain, riviera)).toBe(false)
  })

  it('opens the admin module scoped to their community', () => {
    expect(canOpenAdmin(captain)).toBe(true)
    expect(adminScope(captain)).toEqual([SD])
  })
})

describe('a Host', () => {
  it('manages events only at their approved venues', () => {
    expect(canManageEventsAt(host, aviara)).toBe(true)
    expect(canManageEventsAt(host, torrey)).toBe(false)
    expect(venuesForEvents(host, [aviara, torrey, riviera]).map(v => v.id)).toEqual(['aviara'])
  })

  it('approves nothing and has no admin module', () => {
    expect(canApproveVenue(host, aviara)).toBe(false)
    expect(canApproveHostAt(host, aviara)).toBe(false)
    expect(canOpenAdmin(host)).toBe(false)
  })
})

describe('a member', () => {
  it('can do none of it', () => {
    expect(canManageEventsAt(member, aviara)).toBe(false)
    expect(canOpenAdmin(member)).toBe(false)
    expect(adminScope(member)).toEqual([])
  })
})

describe('withinScope', () => {
  const rows = [aviara, riviera, orphan]
  it('keeps everything for an admin, and a Captain only their community', () => {
    expect(withinScope(rows, 'all')).toHaveLength(3)
    expect(withinScope(rows, [SD]).map(r => r.id)).toEqual(['aviara'])
    expect(withinScope(rows, [])).toEqual([])
  })
})
