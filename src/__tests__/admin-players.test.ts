import { describe, expect, it } from 'vitest'
import {
  adminSeatOwnership,
  isSeatAdminRecordedForOthers,
  normaliseTeeTime,
  parseAdminPlayers,
  splitName,
} from '@/lib/bookings/admin-players'

describe('parseAdminPlayers', () => {
  it('needs only a name', () => {
    const r = parseAdminPlayers([{ name: '  Jo   Smith ' }])
    expect(r).toEqual({
      ok: true,
      players: [{ name: 'Jo Smith', firstName: 'Jo', lastName: 'Smith', email: null, phone: null }],
    })
  })

  it('refuses a player with no name', () => {
    const r = parseAdminPlayers([{ name: 'A' }, { name: ' ', email: 'x@y.com' }])
    expect(r).toEqual({ ok: false, error: 'Player 2 needs a name.' })
  })

  it('refuses an empty list', () => {
    expect(parseAdminPlayers([]).ok).toBe(false)
    expect(parseAdminPlayers(undefined).ok).toBe(false)
  })

  it('has no upper limit on players', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `Player ${i}` }))
    const r = parseAdminPlayers(many)
    expect(r.ok && r.players.length).toBe(25)
  })

  it('checks an email or phone only when one is given, and lower-cases the email', () => {
    const ok = parseAdminPlayers([{ name: 'A', email: ' Jo@Example.COM ', phone: '(760) 555-0100' }])
    expect(ok.ok && ok.players[0]).toMatchObject({ email: 'jo@example.com', phone: '(760) 555-0100' })
    expect(parseAdminPlayers([{ name: 'A', email: 'not-an-email' }]).ok).toBe(false)
    expect(parseAdminPlayers([{ name: 'A', phone: '123' }]).ok).toBe(false)
    expect(parseAdminPlayers([{ name: 'A', email: '', phone: '' }]).ok).toBe(true)
  })
})

describe('splitName', () => {
  it('is the first word and the rest', () => {
    expect(splitName('Mary Ann Smith')).toEqual({ firstName: 'Mary', lastName: 'Ann Smith' })
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '' })
  })
})

describe('normaliseTeeTime', () => {
  it('accepts HH:MM and HH:MM:SS', () => {
    expect(normaliseTeeTime('07:30')).toBe('07:30:00')
    expect(normaliseTeeTime('13:05:00')).toBe('13:05:00')
  })
  it('refuses anything else', () => {
    expect(normaliseTeeTime('7:30')).toBeNull()
    expect(normaliseTeeTime('25:00')).toBeNull()
    expect(normaliseTeeTime(null)).toBeNull()
  })
})

describe('adminSeatOwnership', () => {
  const player = { name: 'Jo Smith', firstName: 'Jo', lastName: 'Smith', email: 'jo@x.com', phone: null }

  it('makes the seat the player’s own round when they have an account', () => {
    expect(adminSeatOwnership(player, 'member-1', 'admin-1')).toEqual({
      member_id: 'member-1',
      guest_name: null,
      player_member_id: null,
      additional_players: [],
      invite_status: null,
    })
  })

  it('books a named seat under the admin when there is no account, and never as an invitation', () => {
    const row = adminSeatOwnership({ ...player, email: null }, null, 'admin-1')
    expect(row.member_id).toBe('admin-1')
    expect(row.guest_name).toBe('Jo Smith')
    expect(row.invite_status).toBeNull()
  })
})

describe('isSeatAdminRecordedForOthers', () => {
  it('hides a named seat from the admin who recorded it', () => {
    expect(isSeatAdminRecordedForOthers({ member_id: 'a', guest_name: 'Jo', added_by_admin_id: 'a' }, 'a')).toBe(true)
  })
  it('keeps the admin’s own rounds and every member-booked row', () => {
    expect(isSeatAdminRecordedForOthers({ member_id: 'a', guest_name: null, added_by_admin_id: 'a' }, 'a')).toBe(false)
    expect(isSeatAdminRecordedForOthers({ member_id: 'a', guest_name: 'Guest', added_by_admin_id: null }, 'a')).toBe(false)
  })
})
