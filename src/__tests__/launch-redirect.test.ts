import { describe, it, expect } from 'vitest'
import { launchRedirect } from '@/lib/nav/launch'

describe('launchRedirect', () => {
  const launch = { initialPath: '/home', navigationType: 'navigate', standalone: true }

  it('sends an installed app opened on /home to Book', () => {
    expect(launchRedirect(launch)).toBe('/book')
    expect(launchRedirect({ ...launch, initialPath: '/home/' })).toBe('/book')
    expect(launchRedirect({ ...launch, navigationType: undefined })).toBe('/book')
  })

  it('leaves /home opened in a browser tab alone', () => {
    expect(launchRedirect({ ...launch, standalone: false })).toBeNull()
  })

  it('leaves a reload or back/forward on Home alone', () => {
    expect(launchRedirect({ ...launch, navigationType: 'reload' })).toBeNull()
    expect(launchRedirect({ ...launch, navigationType: 'back_forward' })).toBeNull()
  })

  it('leaves every other page alone', () => {
    for (const p of ['/book', '/members', '/messages/abc', '/homework', '/']) {
      expect(launchRedirect({ ...launch, initialPath: p })).toBeNull()
    }
  })
})
