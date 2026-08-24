import { describe, it, expect } from 'vitest'
import { proofStoragePath, proofContentType, proofGhlFileName } from '@/lib/hosts/proofs'

// The proof table stores a public URL and nothing else, so every storage
// operation on a proof — deleting a superseded blob, reading one back to mirror
// it to GHL on credit approval — has to get the object path from that URL.
// Getting it wrong means either a stale blob nobody deletes or a mirror that
// silently never runs.

const PUBLIC = 'https://abc.supabase.co/storage/v1/object/public/post-media/'

describe('proofStoragePath', () => {
  it('extracts the object path from a public bucket URL', () => {
    expect(proofStoragePath(`${PUBLIC}host-proofs/evt-1/1723600000000.jpg`))
      .toBe('host-proofs/evt-1/1723600000000.jpg')
  })

  it('decodes an escaped path', () => {
    expect(proofStoragePath(`${PUBLIC}host-proofs/evt%201/a%20b.png`))
      .toBe('host-proofs/evt 1/a b.png')
  })

  it('refuses a URL from another bucket', () => {
    // Deleting or reading from a path we didn't derive from our own bucket is
    // exactly the operation not to guess at.
    expect(proofStoragePath('https://abc.supabase.co/storage/v1/object/public/avatars/x.jpg')).toBeNull()
  })

  it('refuses a signed or non-public URL', () => {
    expect(proofStoragePath('https://abc.supabase.co/storage/v1/object/sign/post-media/x.jpg')).toBeNull()
  })

  it('refuses anything that is not a URL', () => {
    expect(proofStoragePath('host-proofs/evt-1/x.jpg')).toBeNull()
    expect(proofStoragePath('')).toBeNull()
  })

  it('refuses a bucket URL with no object path', () => {
    expect(proofStoragePath(PUBLIC)).toBeNull()
  })
})

describe('proofContentType', () => {
  it('maps the extensions the upload route accepts', () => {
    expect(proofContentType('a/b.jpg')).toBe('image/jpeg')
    expect(proofContentType('a/b.jpeg')).toBe('image/jpeg')
    expect(proofContentType('a/b.PNG')).toBe('image/png')
    expect(proofContentType('a/b.webp')).toBe('image/webp')
  })

  it('refuses anything else, rather than guessing a type for GHL', () => {
    expect(proofContentType('a/b.pdf')).toBeNull()
    expect(proofContentType('a/b')).toBeNull()
  })
})

describe('proofGhlFileName', () => {
  it('names the file so it can be found in the media library unaided', () => {
    expect(proofGhlFileName({
      courseName: 'Aviara Golf Club',
      eventDate: '2026-08-01',
      proofId: 'abcdef12-3456-7890-abcd-ef1234567890',
      ext: 'jpg',
    })).toBe('linkup-proof-aviara-golf-club-2026-08-01-abcdef12.jpg')
  })

  it('falls back when the course name is missing or unusable', () => {
    expect(proofGhlFileName({ courseName: null, eventDate: '2026-08-01', proofId: 'abcdef12', ext: 'png' }))
      .toBe('linkup-proof-event-2026-08-01-abcdef12.png')
    expect(proofGhlFileName({ courseName: '!!!', eventDate: '2026-08-01', proofId: 'abcdef12', ext: 'png' }))
      .toBe('linkup-proof-event-2026-08-01-abcdef12.png')
  })
})
