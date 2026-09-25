import { describe, it, expect } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EMAIL_ASSET_PATHS } from '@/lib/email/send'

// Images in an email are fetched from the live site, not bundled, so the only
// thing a repo can verify is that the file is here to be deployed at all. It
// is worth verifying: a missing one renders as a broken image in every inbox
// it reaches, and nothing before that point complains.

describe('email assets', () => {
  it.each(EMAIL_ASSET_PATHS)('%s exists in public/', path => {
    expect(existsSync(join(process.cwd(), 'public', path))).toBe(true)
  })

  it.each(EMAIL_ASSET_PATHS)('%s is not an empty file', path => {
    expect(statSync(join(process.cwd(), 'public', path)).size).toBeGreaterThan(1024)
  })

  it('uses a format every mail client can render', () => {
    // Outlook on Windows renders through the Word engine, which has never
    // supported WebP or AVIF — a large share of recipients would see a broken
    // image rather than a photo.
    const unsupported = EMAIL_ASSET_PATHS.filter(p => /\.(webp|avif|svg)$/i.test(p))
    expect(unsupported).toEqual([])
  })
})
