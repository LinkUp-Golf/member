'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { createClient } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Loading'
import { INDUSTRY_CATEGORIES } from '@/types'
import { formatRelativeTime } from '@/lib/utils'
import type { Referral } from '@/types'

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  pending:     { label: 'Pending interview', colour: 'text-yellow-600 bg-yellow-50' },
  interviewed: { label: 'Interviewed',       colour: 'text-blue-600 bg-blue-50' },
  approved:    { label: 'Approved',           colour: 'text-green-700 bg-green-50' },
  declined:    { label: 'Declined',           colour: 'text-red-500 bg-red-50' },
  joined:      { label: 'Member ✓',           colour: 'text-green-800 bg-green-100' },
}

export default function ReferralsPage() {
  const { user } = useAuthStore()
  const router = useRouter()
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    if (user) loadReferrals()
  }, [user])

  async function loadReferrals() {
    const supabase = createClient()
    const { data } = await supabase
      .from('referrals')
      .select('*')
      .eq('referring_member_id', user!.id)
      .order('created_at', { ascending: false })
    setReferrals((data ?? []) as Referral[])
    setLoading(false)
  }

  return (
    <div>
      <div className="top-bar flex items-center gap-3">
        <button onClick={() => router.push('/more')} className="text-gold text-sm flex items-center gap-1">
          <BackArrow /> More
        </button>
        <div className="flex-1">
          <div className="logo-text">Refer a Member</div>
          <div className="logo-subtitle">Grow the community</div>
        </div>
      </div>

      <div className="px-5 py-5 pb-8">
        {/* How it works */}
        <div className="card card-pad mb-5 space-y-3">
          <p className="section-label">How referrals work</p>
          <Step n={1} text="You refer someone you believe would be a great fit for the community." />
          <Step n={2} text="They receive a personal invitation email with your name on it." />
          <Step n={3} text="They go through a brief interview to ensure alignment." />
          <Step n={4} text="If approved, their first round is on us — and you're invited to play with them." />
        </div>

        {/* Refer button */}
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="btn btn-gold btn-full mb-6">
            Refer someone
          </button>
        )}

        {/* Referral form */}
        {showForm && (
          <ReferralForm
            onSubmit={async (data) => {
              const supabase = createClient()
              await supabase.from('referrals').insert({
                referring_member_id: user!.id,
                referred_email: data.email,
                status: 'pending',
              })
              // In production, also trigger GHL workflow to send referral email
              setShowForm(false)
              loadReferrals()
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {/* Referral history */}
        {!loading && referrals.length > 0 && (
          <>
            <p className="section-label mb-3">Your referrals</p>
            <div className="card">
              {referrals.map((r, i) => {
                const s = STATUS_LABELS[r.status] ?? { label: r.status, colour: 'text-green-900/50 bg-green-50' }
                return (
                  <div
                    key={r.id}
                    className={`px-4 py-3.5 ${i < referrals.length - 1 ? 'border-b border-green-900/08' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-green-900 truncate">{r.referred_email}</p>
                        <p className="text-xs text-green-900/40 mt-0.5">
                          Referred {formatRelativeTime(r.created_at)}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${s.colour}`}>
                        {s.label}
                      </span>
                    </div>
                    {r.status === 'joined' && r.joint_round_booked && (
                      <p className="text-xs text-green-600 mt-1.5">✓ Introductory round booked</p>
                    )}
                    {r.status === 'joined' && !r.joint_round_booked && (
                      <button
                        onClick={() => router.push(`/book?intro=${r.referred_member_id}`)}
                        className="text-xs text-gold mt-1.5"
                      >
                        Book your introductory round together →
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!loading && referrals.length === 0 && !showForm && (
          <p className="text-center text-sm text-green-900/40 italic py-4">
            You haven't referred anyone yet.
          </p>
        )}
      </div>
    </div>
  )
}

// ---- Referral form ------------------------------------------

function ReferralForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: { name: string; email: string; category: string; note: string }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!name.trim() || !email.trim() || !category) return
    setSubmitting(true)
    await onSubmit({ name, email, category, note })
    setSubmitting(false)
  }

  return (
    <div className="card card-pad mb-6 space-y-4">
      <p className="section-label">New referral</p>

      <div>
        <label className="text-xs text-green-900/50 mb-1.5 block">Their full name</label>
        <input className="input" placeholder="John Smith" value={name} onChange={e => setName(e.target.value)} />
      </div>

      <div>
        <label className="text-xs text-green-900/50 mb-1.5 block">Their email address</label>
        <input type="email" className="input" placeholder="john@company.com" value={email} onChange={e => setEmail(e.target.value)} />
      </div>

      <div>
        <label className="text-xs text-green-900/50 mb-1.5 block">Their industry / role</label>
        <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Select a category…</option>
          {INDUSTRY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div>
        <label className="text-xs text-green-900/50 mb-1.5 block">Why you're referring them (optional)</label>
        <textarea
          className="input resize-none"
          rows={3}
          placeholder="How do you know them? Why would they be a great fit?"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={onCancel} className="btn btn-outline flex-1 justify-center" disabled={submitting}>
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || !email.trim() || !category || submitting}
          className="btn btn-gold flex-1 justify-center"
        >
          {submitting ? <Spinner className="w-4 h-4 text-green-900" /> : 'Send referral'}
        </button>
      </div>
    </div>
  )
}

// ---- Sub-components -----------------------------------------

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

function BackArrow() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  )
}
