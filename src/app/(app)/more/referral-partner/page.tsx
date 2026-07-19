'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { BadgeDollarSign } from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'
import { apiClient } from '@/lib/api-client'
import { Spinner } from '@/components/ui/Loading'
import AppShell from '@/components/layout/AppShell'
import { formatRelativeTime } from '@/lib/utils'
import type { ReferralPartner, ReferralPartnerApplication } from '@/types'

interface ApplicationState {
  application: ReferralPartnerApplication | null
  partner: Pick<ReferralPartner, 'id' | 'name' | 'code' | 'percentage' | 'ends_at'> | null
}

export default function ReferralPartnerApplicationPage() {
  const { user } = useProfile()
  const [state, setState] = useState<ApplicationState>({ application: null, partner: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await apiClient.get<ApplicationState>('/api/referral-partner/application')
    if (res.data) setState(res.data)
    setLoading(false)
  }, [])

  useEffect(() => { if (user) load() }, [user, load])

  const { application, partner } = state
  const isPending = application?.status === 'pending'
  const wasRejected = application?.status === 'rejected'
  // The partner row is the role — an admin can grant it without an application.
  const isPartner = !!partner

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="font-sans font-black text-2xl" style={{ color: 'var(--color-gold)' }}>Referral Partner</div>
            <div className="logo-subtitle">Earn on every member you bring in</div>
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
              <Step n={1} text="Apply to become a referral partner and tell us how you'd grow the community." />
              <Step n={2} text="An admin reviews your application and sets your commission rate." />
              <Step n={3} text="Refer members and non-members — we track every one of them for you." />
              <Step n={4} text="Earn commission on each referral who becomes a paying member, paid monthly." />
            </div>

            {/* Already a partner */}
            {isPartner && (
              <div className="card card-pad mb-5">
                <StatusPill label="Approved" tone="green" />
                <p className="text-sm text-green-900/70 leading-relaxed mt-3">
                  You&apos;re a referral partner earning <strong>{partner.percentage}%</strong> commission on
                  every referral who joins
                  {partner.ends_at ? ` (rate valid until ${fmtDate(partner.ends_at)})` : ''}.
                </p>
                <p className="text-xs text-green-900/40 mt-2">
                  Your referral code: <code className="bg-green-900/05 px-1.5 py-0.5 rounded">{partner.code}</code>
                </p>
                <Link href="/partner" className="btn btn-gold btn-full justify-center mt-4">
                  Open referral dashboard
                </Link>
              </div>
            )}

            {/* Under review */}
            {!isPartner && isPending && (
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
            {!isPartner && wasRejected && (
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

            {/* Apply — available when not a partner and nothing is pending */}
            {!isPartner && !isPending && (
              <ApplicationForm
                heading={wasRejected ? 'Apply again' : 'Apply to become a partner'}
                error={error}
                onSubmit={async (motivation) => {
                  setError(null)
                  const res = await apiClient.post('/api/referral-partner/application', { motivation })
                  if (res.error) { setError(res.error.message); return false }
                  await load()
                  return true
                }}
              />
            )}

            {!isPartner && !isPending && !wasRejected && (
              <p className="text-xs text-green-900/35 text-center mt-5 flex items-center justify-center gap-1.5">
                <BadgeDollarSign className="w-3.5 h-3.5" strokeWidth={1.75} />
                Commission is paid monthly by the LinkUp team.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// ---- Application form ---------------------------------------

const MIN_MOTIVATION = 20
const MAX_MOTIVATION = 1000

function ApplicationForm({
  heading,
  error,
  onSubmit,
}: {
  heading: string
  error: string | null
  onSubmit: (motivation: string) => Promise<boolean>
}) {
  const [motivation, setMotivation] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const tooShort = motivation.trim().length < MIN_MOTIVATION

  async function handleSubmit() {
    if (tooShort || submitting) return
    setSubmitting(true)
    const ok = await onSubmit(motivation.trim())
    if (ok) setMotivation('')
    setSubmitting(false)
  }

  return (
    <div className="card card-pad space-y-4">
      <p className="section-label">{heading}</p>

      <div>
        <label htmlFor="partner-motivation" className="text-xs text-green-900/50 mb-1.5 block">
          Why would you make a great referral partner?
        </label>
        <textarea
          id="partner-motivation"
          className="input resize-none"
          rows={5}
          maxLength={MAX_MOTIVATION}
          placeholder="Tell us about your network, the members you'd bring in, and how you'd represent LinkUp."
          value={motivation}
          onChange={e => setMotivation(e.target.value)}
        />
        <p className="text-xs text-green-900/35 mt-1.5">
          {tooShort
            ? `At least ${MIN_MOTIVATION} characters (${motivation.trim().length}/${MIN_MOTIVATION}).`
            : `${motivation.length}/${MAX_MOTIVATION} characters.`}
        </p>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={tooShort || submitting}
        className="btn btn-gold btn-full justify-center"
      >
        {submitting ? <Spinner className="w-4 h-4 text-green-900" /> : 'Submit application'}
      </button>
    </div>
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
