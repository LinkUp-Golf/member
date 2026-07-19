'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import {
  AdminPageHeader, AdminTable, AdminTr, AdminTd, StatCard,
} from '@/components/admin/AdminUI'
import { DEFAULT_REFERRAL_PERCENTAGE } from '@/lib/constants'
import { isRateExpired } from '@/lib/referral-rate'
import ReferralApplications from '@/components/admin/ReferralApplications'
import ReferralContactPicker, { type ReferralSelection } from '@/components/admin/ReferralContactPicker'
import type { ReferralPartnerWithStats } from '@/types'

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

type Tab = 'partners' | 'applications'

export default function AdminReferralPartnersPage() {
  const [tab, setTab] = useState<Tab>('partners')
  const [pendingCount, setPendingCount] = useState(0)
  const [partners, setPartners] = useState<ReferralPartnerWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<ReferralPartnerWithStats | null>(null)
  const [deleting, setDeleting] = useState<ReferralPartnerWithStats | null>(null)
  const [processing, setProcessing] = useState(false)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadPartners = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/referral-partners')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) showToast(json.error ?? 'Failed to load referral partners.', false)
    setPartners(Array.isArray(json.partners) ? json.partners : [])
    setLoading(false)
  }, [])

  // Drives the tab's pending badge, so it's fetched regardless of which tab is
  // open. The Applications tab loads the full list itself when shown.
  const loadPendingCount = useCallback(async () => {
    const res = await fetch('/api/admin/referral-partner-applications?status=pending')
    const json = await res.json().catch(() => ({}))
    setPendingCount(Array.isArray(json.applications) ? json.applications.length : 0)
  }, [])

  useEffect(() => { loadPartners(); loadPendingCount() }, [loadPartners, loadPendingCount])

  async function deletePartner(partner: ReferralPartnerWithStats) {
    setProcessing(true)
    const res = await fetch(`/api/admin/referral-partners/${partner.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (res.ok) { showToast('Referral partner deleted.'); setDeleting(null) }
    else showToast(json.error ?? 'Delete failed.', false)
    await loadPartners()
    setProcessing(false)
  }

  const totals = partners.reduce(
    (acc, p) => ({
      referred: acc.referred + p.referredCount,
      active: acc.active + p.activeCount,
      commission: acc.commission + p.commissionOwed,
    }),
    { referred: 0, active: 0, commission: 0 }
  )

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <AdminPageHeader
          title="Referral Partners"
          description="Manage referral partners, review applications, and track commission"
        />
        {tab === 'partners' && (
          <button
            onClick={() => { setEditing(null); setShowCreate(true) }}
            className="flex-shrink-0 px-4 py-2 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 transition-colors"
          >
            + Add Partner
          </button>
        )}
      </div>

      {/* Tabs — reviewing an application ends in creating a partner, so both
          live on this page rather than in separate destinations. */}
      <div className="flex gap-1 mb-6 border-b border-gray-100">
        {([
          { id: 'partners' as const,     label: 'Partners' },
          { id: 'applications' as const, label: 'Applications' },
        ]).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
              tab === t.id
                ? 'border-green-900 text-green-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.id === 'applications' && pendingCount > 0 && (
              <span
                className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: '#85bb65', color: '#002669' }}
              >
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {toast && (
        <div className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {tab === 'applications' && (
        <ReferralApplications
          onToast={showToast}
          onReviewed={() => { loadPartners(); loadPendingCount() }}
        />
      )}

      {tab === 'partners' && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Partners"    value={partners.length}    sub="Active affiliates"    colour="green" />
          <StatCard label="Referred"    value={totals.referred}    sub="Members & non-members" colour="blue" />
          <StatCard label="Active"      value={totals.active}      sub="Paying members"        colour="green" />
          <StatCard label="Commission"  value={fmtMoney(totals.commission)} sub="Owed to date" colour="gold" />
        </div>
      )}

      {tab === 'partners' && (loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <AdminTable
          headers={['Partner', 'Code', 'Rate', 'Referred', 'Active', 'Commission', '']}
          empty={partners.length === 0 ? 'No referral partners yet. Add one to get started.' : undefined}
        >
          {partners.map(p => (
            <AdminTr key={p.id}>
              <AdminTd className="font-medium text-gray-900">
                <Link href={`/admin/referrals/${p.id}`} className="hover:text-green-800 hover:underline">
                  {p.name}
                </Link>
              </AdminTd>
              <AdminTd><code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{p.code}</code></AdminTd>
              <AdminTd>
                <span className={isRateExpired(p.ends_at) ? 'text-gray-400 line-through' : undefined}>
                  {p.percentage}%
                </span>
                {p.ends_at && (
                  <span className={`block text-xs ${isRateExpired(p.ends_at) ? 'text-red-500' : 'text-gray-400'}`}>
                    {isRateExpired(p.ends_at) ? 'Expired' : 'Until'} {fmtDate(p.ends_at)}
                  </span>
                )}
              </AdminTd>
              <AdminTd>{p.referredCount} <span className="text-gray-400 text-xs">({p.nonMemberCount} non-member)</span></AdminTd>
              <AdminTd>{p.activeCount}</AdminTd>
              <AdminTd className="font-medium">{fmtMoney(p.commissionOwed)}</AdminTd>
              <AdminTd className="text-right whitespace-nowrap">
                <button
                  onClick={() => { setEditing(p); setShowCreate(true) }}
                  className="text-xs font-medium text-gray-500 hover:text-green-800 px-2 py-1"
                >
                  Edit
                </button>
                <button
                  onClick={() => setDeleting(p)}
                  className="text-xs font-medium text-red-500 hover:text-red-700 px-2 py-1"
                >
                  Delete
                </button>
              </AdminTd>
            </AdminTr>
          ))}
        </AdminTable>
      ))}

      {showCreate && (
        <PartnerDrawer
          editing={editing}
          onClose={() => setShowCreate(false)}
          onSaved={(msg) => { setShowCreate(false); showToast(msg); loadPartners() }}
          onError={(msg) => showToast(msg, false)}
        />
      )}

      {deleting && (
        <DeletePartnerModal
          partner={deleting}
          processing={processing}
          onConfirm={() => deletePartner(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

// ---- Create / edit drawer -----------------------------------

type PartnerFormValues = { name: string; code: string; percentage: number | ''; ends_at: string }

function PartnerDrawer({ editing, onClose, onSaved, onError }: {
  editing: ReferralPartnerWithStats | null
  onClose: () => void
  onSaved: (msg: string) => void
  onError: (msg: string) => void
}) {
  const isEdit = !!editing
  const {
    register, handleSubmit, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<PartnerFormValues>({
    defaultValues: {
      name: editing?.name ?? '',
      code: editing?.code ?? '',
      percentage: editing?.percentage ?? DEFAULT_REFERRAL_PERCENTAGE,
      ends_at: editing?.ends_at?.slice(0, 10) ?? '',
    },
  })

  // Auto-fill code from name until the admin manually edits it.
  const [codeTouched, setCodeTouched] = useState(isEdit)
  const watchedName = watch('name')
  useEffect(() => {
    if (!codeTouched) setValue('code', toSlug(watchedName))
  }, [watchedName, codeTouched, setValue])

  // Members / non-members to map onto this partner once it's saved.
  const [selection, setSelection] = useState<ReferralSelection>({ memberIds: [], emails: [] })

  // When editing, pre-select the partner's already-linked members/non-members
  // so the form reflects the current state.
  useEffect(() => {
    if (!isEdit || !editing) return
    let cancelled = false
    fetch(`/api/admin/referral-partners/${editing.id}/links`)
      .then(r => r.json())
      .then((j: { links?: Array<{ member_id: string | null; email: string }> }) => {
        if (cancelled) return
        const links = Array.isArray(j.links) ? j.links : []
        setSelection({
          memberIds: links.filter(l => l.member_id).map(l => l.member_id as string),
          emails: links.filter(l => !l.member_id).map(l => l.email),
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isEdit, editing])

  const field = (hasError: boolean) =>
    `w-full px-3 py-2 text-sm rounded-xl border outline-none transition-colors bg-white ${hasError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-green-700'}`
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
  const errMsg = 'text-xs text-red-500 mt-1'

  async function onSubmit(data: PartnerFormValues) {
    try {
      const payload = {
        name: data.name.trim(),
        code: data.code.trim(),
        percentage: Number(data.percentage),
        ends_at: data.ends_at || null,
      }
      const res = await fetch(
        isEdit ? `/api/admin/referral-partners/${editing.id}` : '/api/admin/referral-partners',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { onError(json.error ?? 'Save failed.'); return }

      const partnerId: string | undefined = json.partner?.id ?? (isEdit ? editing.id : undefined)

      // Map the selected members/non-members onto the partner.
      let linkedMsg = ''
      if (partnerId && (selection.memberIds.length || selection.emails.length)) {
        const linkRes = await fetch(`/api/admin/referral-partners/${partnerId}/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selection),
        })
        const linkJson = await linkRes.json().catch(() => ({}))
        if (linkRes.ok) {
          const failed = (linkJson.failed ?? []).length
          linkedMsg = ` Referred ${linkJson.succeeded ?? 0} contact${linkJson.succeeded !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.`
        } else {
          linkedMsg = ` (Partner saved, but referring failed: ${linkJson.error ?? 'unknown error'})`
        }
      }

      onSaved((isEdit ? 'Referral partner updated.' : 'Referral partner created.') + linkedMsg)
    } catch {
      onError('Network error. Check your connection and try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? 'Edit Partner' : 'Add Partner'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto px-6 py-6 space-y-5" noValidate>
          <div>
            <label htmlFor="partner-name" className={labelCls}>Partner Name *</label>
            <input
              id="partner-name"
              className={field(!!errors.name)}
              placeholder="Acme Golf Group"
              {...register('name', { required: 'Partner name is required' })}
            />
            {errors.name && <p className={errMsg}>{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="partner-code" className={labelCls}>Referral Code *</label>
            <input
              id="partner-code"
              className={field(!!errors.code)}
              placeholder="acme-golf-group"
              {...register('code', {
                required: 'Referral code is required',
                pattern: { value: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: 'Lowercase letters, numbers, and hyphens only' },
                onChange: () => setCodeTouched(true),
              })}
            />
            {errors.code
              ? <p className={errMsg}>{errors.code.message}</p>
              : <p className="mt-1 text-[11px] text-gray-400">The partner&apos;s public referral code (unique).</p>}
          </div>

          <div>
            <label htmlFor="partner-pct" className={labelCls}>Commission Percentage *</label>
            <div className="relative">
              <input
                id="partner-pct"
                type="number"
                step="0.5"
                min={0}
                max={100}
                className={`${field(!!errors.percentage)} pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                {...register('percentage', {
                  required: 'Percentage is required',
                  min: { value: 0, message: 'Must be 0 or more' },
                  max: { value: 100, message: 'Must be 100 or less' },
                })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
            </div>
            {errors.percentage && <p className={errMsg}>{errors.percentage.message}</p>}
          </div>

          <div>
            <label htmlFor="partner-ends-at" className={labelCls}>Rate Valid Until</label>
            <input
              id="partner-ends-at"
              type="date"
              className={field(!!errors.ends_at)}
              {...register('ends_at')}
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Last day this rate is honoured. Referrals who become members after it earn no commission.
              Leave blank for no expiry.
            </p>
          </div>

          <div className="pt-1 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-1">Refer contacts</h3>
            <p className="text-[11px] text-gray-400 mb-3">
              Optionally select members and add non-member emails now — they&apos;re attributed to this partner when
              you save. Non-members are also created in your CRM as leads.
            </p>
            <ReferralContactPicker value={selection} onChange={setSelection} />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save Changes' : 'Create Partner')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---- Delete confirm modal -----------------------------------

function DeletePartnerModal({ partner, processing, onConfirm, onClose }: {
  partner: ReferralPartnerWithStats
  processing: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-gray-900 text-center mb-2">Delete Referral Partner</h2>
        <p className="text-sm text-gray-500 text-center mb-1">You&apos;re about to permanently delete</p>
        <p className="text-sm font-semibold text-gray-800 text-center mb-4">&ldquo;{partner.name}&rdquo;</p>
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-6">
          <p className="text-xs text-amber-700">
            This removes its {partner.referredCount} referral{partner.referredCount !== 1 ? 's' : ''}. The referred
            members and CRM contacts themselves are not deleted.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={processing}
            className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {processing ? 'Deleting…' : 'Delete Partner'}
          </button>
        </div>
      </div>
    </div>
  )
}
