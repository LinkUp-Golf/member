import { flag } from '@vercel/flags/next'

// Feature flag definitions.
// Evaluated server-side; the Vercel toolbar can override values via
// an encrypted cookie (vercel-flag-overrides) when FLAGS_SECRET is set.
// Middleware reads these and stamps plain cookies so client components
// can read them synchronously without async calls.

export const focusLinkupsFlag = flag<boolean>({
  key: 'focus-linkups',
  defaultValue: true,
  description: 'Enable the Focus LinkUps feature for members and admins.',
  options: [
    { value: false, label: 'Disabled' },
    { value: true,  label: 'Enabled'  },
  ],
  decide() {
    return process.env.NEXT_PUBLIC_FEATURE_FOCUS_LINKUPS !== 'false'
  },
})
