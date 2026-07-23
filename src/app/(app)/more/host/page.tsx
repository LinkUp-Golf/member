'use client'

import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import Link from 'next/link'
import { Flag } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import { Spinner } from '@/components/ui/Loading'
import AppShell from '@/components/layout/AppShell'
import { formatRelativeTime } from '@/lib/utils'
import type { Host, HostApplication, Course } from '@/types'

type VenueOption = Pick<Course, 'id' | 'name' | 'city'>

interface ApplicationState {
  application: HostApplication | null
  host: Pick<Host, 'id' | 'name' | 'status'> | null
}

export default function HostApplicationPage() {
  const { user } = useProfile()
  const [state, setState] = useState<ApplicationState>({ application: null, host: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await apiClient.get<ApplicationState>('/api/host/application')
    if (res.data) setState(res.data)
    setLoading(false)
  }, [])

  useEffect(() => { if (user) load() }, [user, load])

  const { application, host } = state
  const isPending = application?.status === 'pending'
  const wasRejected = application?.status === 'rejected'
  // The host row is the role — an admin can grant it without an application.
  const isHost = !!host

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="font-sans font-black text-2xl" style={{ color: 'var(--color-gold)' }}>Become a Host</div>
            <div className="logo-subtitle">Run your own rounds and earn credits</div>
          </div>
        </div>
      }
    >
      <div className="px-5 py-5 pb-8">
        {loading ? (
          <div className="py-16 flex justify-center"><Spinner className="w-5 h-5 text-green-900" /></div>
        ) : (
          <>
            {/* How it works */}
            <div className="card card-pad mb-5 space-y-3">
              <p className="section-label">How it works</p>
              <Step n={1} text="Apply to become a host and tell us the kind of events you'd run." />
              <Step n={2} text="An admin reviews your application and grants you the host role." />
              <Step n={3} text="Create events at a course with limited spots — members reserve them." />
              <Step n={4} text="After the event, upload proof. Once approved, you earn credits you can redeem." />
            </div>

            {/* Already a host */}
            {isHost && (
              <div className="card card-pad mb-5">
                <StatusPill label="Approved" tone="green" />
                <p className="text-sm text-green-900/70 leading-relaxed mt-3">
                  You&apos;re a host, operating as <strong>{host.name}</strong>. Create events and track your
                  credits from your dashboard.
                </p>
                <Link href="/host" className="btn btn-gold btn-full justify-center mt-4">
                  Open host dashboard
                </Link>
              </div>
            )}

            {/* Under review */}
            {!isHost && isPending && (
              <div className="card card-pad mb-5">
                <StatusPill label="Under review" tone="yellow" />
                <p className="text-sm text-green-900/70 leading-relaxed mt-3">
                  Your application is with our team. We&apos;ll notify you as soon as it&apos;s been reviewed.
                </p>
                <p className="text-xs text-green-900/40 mt-2">
                  Submitted {formatRelativeTime(application.created_at)}
                </p>
              </div>
            )}

            {/* Rejected — may re-apply */}
            {!isHost && wasRejected && (
              <div className="card card-pad mb-5">
                <StatusPill label="Not approved" tone="red" />
                {application.rejection_reason && (
                  <p className="text-sm text-green-900/70 leading-relaxed mt-3">
                    {application.rejection_reason}
                  </p>
                )}
                <p className="text-xs text-green-900/40 mt-2">
                  Reviewed {application.reviewed_at ? formatRelativeTime(application.reviewed_at) : 'recently'} ·
                  you&apos;re welcome to apply again below.
                </p>
              </div>
            )}

            {/* Apply — available when not a host and nothing is pending */}
            {!isHost && !isPending && (
              <ApplicationForm
                heading={wasRejected ? 'Apply again' : 'Apply to become a host'}
                error={error}
                onSubmit={async ({ name, description, course_ids }) => {
                  setError(null)
                  const res = await apiClient.post('/api/host/application', { name, description, course_ids })
                  if (res.error) { setError(res.error.message); return false }
                  await load()
                  return true
                }}
              />
            )}

            {!isHost && !isPending && !wasRejected && (
              <p className="text-xs text-green-900/35 text-center mt-5 flex items-center justify-center gap-1.5">
                <Flag className="w-3.5 h-3.5" strokeWidth={1.75} />
                Credits are awarded after each event, once an admin approves your proof.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}

// ---- Application form ---------------------------------------

const NAME_MIN = 2
const NAME_MAX = 120
const DESC_MIN = 20
const DESC_MAX = 1000

type ApplicationValues = { name: string; description: string }
type SubmitValues = ApplicationValues & { course_ids: string[] }

function ApplicationForm({
  heading,
  error,
  onSubmit,
}: {
  heading: string
  /** Server-side error (e.g. "you already have an application under review"). */
  error: string | null
  onSubmit: (values: SubmitValues) => Promise<boolean>
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ApplicationValues>({ defaultValues: { name: '', description: '' } })

  const [venues, setVenues] = useState<VenueOption[]>([])
  const [venueIds, setVenueIds] = useState<string[]>([])
  const [venueError, setVenueError] = useState<string | null>(null)

  useEffect(() => {
    apiClient.get<{ courses: VenueOption[] }>('/api/courses').then(res => {
      if (res.data?.courses) setVenues(res.data.courses)
    })
  }, [])

  const toggleVenue = (id: string) =>
    setVenueIds(prev => (prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]))

  const submit = handleSubmit(async (data) => {
    if (venueIds.length === 0) { setVenueError('Choose at least one venue you want to host at.'); return }
    setVenueError(null)
    const ok = await onSubmit({ name: data.name.trim(), description: data.description.trim(), course_ids: venueIds })
    if (ok) { reset(); setVenueIds([]) }
  })

  return (
    <form onSubmit={submit} className="card card-pad space-y-4" noValidate>
      <p className="section-label">{heading}</p>

      <div>
        <label htmlFor="host-name" className="text-xs text-green-900/50 mb-1.5 block">
          Host name
        </label>
        <input
          id="host-name"
          className="input"
          placeholder="The name you'll host under — your own or a brand"
          {...register('name', {
            required: 'Enter a host name',
            maxLength: { value: NAME_MAX, message: `At most ${NAME_MAX} characters` },
            validate: v => v.trim().length >= NAME_MIN || `At least ${NAME_MIN} characters`,
          })}
        />
        {errors.name && <p className="text-xs text-red-500 mt-1.5">{errors.name.message}</p>}
      </div>

      <div>
        <label htmlFor="host-description" className="text-xs text-green-900/50 mb-1.5 block">
          Description
        </label>
        <textarea
          id="host-description"
          className="input resize-none"
          rows={5}
          maxLength={DESC_MAX}
          placeholder="Tell us about the events you'd run, how often, and who you'd bring together."
          {...register('description', {
            required: 'Add a short description',
            maxLength: { value: DESC_MAX, message: `At most ${DESC_MAX} characters` },
            validate: v => v.trim().length >= DESC_MIN || `At least ${DESC_MIN} characters`,
          })}
        />
        {errors.description && <p className="text-xs text-red-500 mt-1.5">{errors.description.message}</p>}
      </div>

      <div>
        <span className="text-xs text-green-900/50 mb-1.5 block">Which venues do you want to host at?</span>
        {venues.length === 0 ? (
          <p className="text-xs text-green-900/35">Loading venues…</p>
        ) : (
          <div className="space-y-1.5">
            {venues.map(v => (
              <label key={v.id} className="flex items-center gap-3 rounded-xl border border-green-900/10 px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-green-900/30 text-green-900 focus:ring-green-800"
                  checked={venueIds.includes(v.id)}
                  onChange={() => toggleVenue(v.id)}
                />
                <span className="text-sm text-green-900/80">{v.city ? `${v.name} — ${v.city}` : v.name}</span>
              </label>
            ))}
          </div>
        )}
        {venueError && <p className="text-xs text-red-500 mt-1.5">{venueError}</p>}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button type="submit" disabled={isSubmitting} className="btn btn-gold btn-full justify-center">
        {isSubmitting ? <Spinner className="w-4 h-4 text-green-900" /> : 'Submit application'}
      </button>
    </form>
  )
}

// ---- Sub-components -----------------------------------------

const PILL_TONES = {
  green:  'text-green-800 bg-green-100',
  yellow: 'text-yellow-700 bg-yellow-50',
  red:    'text-red-500 bg-red-50',
} as const

function StatusPill({ label, tone }: { label: string; tone: keyof typeof PILL_TONES }) {
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${PILL_TONES[tone]}`}>
      {label}
    </span>
  )
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-6 h-6 rounded-full bg-green-900 text-gold text-xs font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
        {n}
      </div>
      <p className="text-sm text-green-900/70 leading-relaxed">{text}</p>
    </div>
  )
}
