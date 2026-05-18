// ============================================================
// Environment variable validation.
// Called at module import time — fails fast on startup if
// required secrets are missing rather than at runtime.
// ============================================================

interface EnvSchema {
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: string
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  // GHL
  GHL_API_KEY: string
  GHL_LOCATION_ID: string
  GHL_AVIARA_CALENDAR_ID: string
  GHL_WEBHOOK_SECRET: string
  // App
  NEXT_PUBLIC_APP_URL: string
  // Push
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_CONTACT_EMAIL: string
  // Cron
  CRON_SECRET: string
  // Optional
  REDIS_URL?: string
  LOG_LEVEL?: string
}

type RequiredEnvKey = Exclude<keyof EnvSchema, 'REDIS_URL' | 'LOG_LEVEL'>

const REQUIRED: RequiredEnvKey[] = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GHL_API_KEY',
  'GHL_LOCATION_ID',
  'GHL_AVIARA_CALENDAR_ID',
  'GHL_WEBHOOK_SECRET',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_CONTACT_EMAIL',
  'CRON_SECRET',
]

function validate(): EnvSchema {
  const missing: string[] = []

  for (const key of REQUIRED) {
    if (!process.env[key]) missing.push(key)
  }

  if (missing.length > 0) {
    // In production, throw hard. In development, warn so devs can still
    // work with partial env (e.g., only Supabase configured locally).
    const msg = `Missing required environment variables: ${missing.join(', ')}`
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg)
    } else {
      console.warn(`[env] WARNING: ${msg}`)
    }
  }

  // Validate CRON_SECRET minimum length (security requirement)
  const cronSecret = process.env.CRON_SECRET ?? ''
  if (cronSecret.length > 0 && cronSecret.length < 32) {
    console.warn('[env] WARNING: CRON_SECRET should be at least 32 characters')
  }

  return process.env as unknown as EnvSchema
}

export const env = validate()

export const isDev = process.env.NODE_ENV === 'development'
export const isProd = process.env.NODE_ENV === 'production'
export const isTest = process.env.NODE_ENV === 'test'
