'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Upload, FileText, Download, X } from 'lucide-react'
import { AdminPageHeader, AdminCard, Badge, StatCard } from '@/components/admin/AdminUI'
import { parseReferralCsv, type ReferralCsvResult } from '@/lib/csv'
import type { ReferralPartnerSubmission, ReferralSubmissionEntry } from '@/types'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const MAX_ENTRIES = 200
const MAX_BYTES = 512 * 1024

// A file the partner can fill in, so the required columns are unambiguous.
const TEMPLATE_CSV = 'name,email\r\nJane Smith,jane@example.com\r\nMark Lee,mark@example.com\r\n'

export default function PartnerSubmissionsPage() {
  const [submissions, setSubmissions] = useState<ReferralPartnerSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4500)
  }

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/submissions')
    const json = await res.json().catch(() => ({}))
    setSubmissions(Array.isArray(json.submissions) ? json.submissions : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const hasPending = submissions.some(s => s.status === 'pending')
  const totalImported = submissions.reduce((sum, s) => sum + (s.imported_count ?? 0), 0)

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Submit Referrals"
        description="Upload a CSV of the people you've referred for the LinkUp team to import"
      />

      {toast && (
        <div className={`fixed top-6 right-6 left-6 sm:left-auto z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <StatCard label="Lists sent"      value={submissions.length}   sub="All time"        colour="blue" />
          <StatCard label="Imported"        value={totalImported}        sub="Referrals added" colour="green" />
          <StatCard label="Awaiting review" value={hasPending ? 1 : 0}   sub="Pending lists"   colour="gold" />
        </div>
      )}

      {!loading && !hasPending && (
        <div className="mb-8">
          <UploadForm
            onSubmitted={(msg) => { showToast(msg); load() }}
            onError={(msg) => showToast(msg, false)}
          />
        </div>
      )}

      {!loading && hasPending && (
        <div className="mb-8 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-700">
            You have a list awaiting review. Once the LinkUp team imports it you can upload another.
          </p>
        </div>
      )}

      <AdminCard title="Your Submissions">
        {loading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            No lists submitted yet. Upload your first CSV above.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {submissions.map(s => {
              const isOpen = expanded === s.id
              const entries = s.entries ?? []
              return (
                <div key={s.id} className="py-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {s.csv_filename ?? `${s.entry_count} referrals`}
                      </p>
                      <p className="text-xs text-gray-400">
                        {s.entry_count} referral{s.entry_count !== 1 ? 's' : ''} · {fmtDate(s.created_at)}
                        {s.status === 'imported' ? ` · ${s.imported_count ?? 0} added` : ''}
                      </p>
                    </div>
                    <Badge
                      label={s.status === 'imported' ? 'Imported' : s.status === 'rejected' ? 'Not imported' : 'Pending'}
                      colour={s.status === 'imported' ? 'green' : s.status === 'rejected' ? 'red' : 'gold'}
                    />
                  </button>

                  {s.status === 'rejected' && s.rejection_reason && (
                    <p className="text-xs text-red-500 mt-1.5">{s.rejection_reason}</p>
                  )}

                  {isOpen && entries.length > 0 && (
                    <div className="mt-3 ml-1 pl-3 border-l border-gray-100 space-y-2">
                      {entries.map((e: ReferralSubmissionEntry) => (
                        <div key={e.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-gray-600 truncate">{e.name ?? e.email}</p>
                            {e.name && <p className="text-[11px] text-gray-400 truncate">{e.email}</p>}
                          </div>
                          <span className={`text-[11px] flex-shrink-0 text-right ${
                            e.status === 'imported' ? 'text-green-700' : 'text-gray-400'
                          }`}>
                            {e.status === 'imported' ? 'Added' : e.skip_reason ?? 'Pending'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ---- Upload form --------------------------------------------

function UploadForm({
  onSubmitted,
  onError,
}: {
  onSubmitted: (msg: string) => void
  onError: (msg: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [parsed, setParsed] = useState<ReferralCsvResult | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [dragging, setDragging] = useState(false)

  // Validate the moment a file is chosen, so a wrong-shaped CSV is caught here
  // rather than after a round trip. The server re-checks regardless.
  async function accept(f: File) {
    if (f.size > MAX_BYTES) { onError('That file is too large (max 512KB).'); return }
    const text = await f.text()
    setFile({ name: f.name, text })
    setParsed(parseReferralCsv(text))
  }

  function clear() {
    setFile(null)
    setParsed(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'referral-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const tooMany = (parsed?.rows.length ?? 0) > MAX_ENTRIES
  const canSubmit = !!file && !!parsed?.valid && !tooMany && !submitting

  async function submit() {
    if (!canSubmit || !file) return
    setSubmitting(true)
    const res = await fetch('/api/partner/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: file.text, filename: file.name, note: note.trim() || undefined }),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { onError(json.error ?? 'Could not submit your list.'); return }

    const count = parsed?.rows.length ?? 0
    clear()
    setNote('')
    onSubmitted(`Submitted ${count} referral${count !== 1 ? 's' : ''} for review.`)
  }

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'

  return (
    <AdminCard title="Upload Referral List">
      <div className="space-y-4">
        {/* Format guidance */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 flex items-start justify-between gap-3">
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Your CSV needs a header row with a <strong>name</strong> and an <strong>email</strong> column.
            Order and casing don&apos;t matter; other columns are ignored. Every row must have a name
            and a valid email address.
          </p>
          <button
            type="button"
            onClick={downloadTemplate}
            className="flex-shrink-0 flex items-center gap-1.5 text-[11px] font-medium text-green-800 hover:underline"
          >
            <Download className="w-3.5 h-3.5" strokeWidth={2} />
            Template
          </button>
        </div>

        {/* Drop zone */}
        {!file ? (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              const dropped = e.dataTransfer.files?.[0]
              if (dropped) accept(dropped)
            }}
            className={`rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
              dragging ? 'border-green-700 bg-green-50/50' : 'border-gray-200'
            }`}
          >
            <Upload className="w-6 h-6 mx-auto text-gray-300 mb-2" strokeWidth={1.75} />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-sm font-medium text-green-800 hover:underline"
            >
              Choose a CSV file
            </button>
            <p className="text-[11px] text-gray-400 mt-1">or drag it here</p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) accept(f) }}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3">
            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" strokeWidth={1.9} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
              <p className="text-[11px] text-gray-400">
                {parsed?.valid
                  ? `${parsed.rows.length} referral${parsed.rows.length !== 1 ? 's' : ''} ready`
                  : `${parsed?.errors.length ?? 0} problem${parsed?.errors.length !== 1 ? 's' : ''} found`}
              </p>
            </div>
            <button
              type="button"
              onClick={clear}
              aria-label="Remove file"
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>
        )}

        {/* Every problem blocks submission — nothing is silently dropped, so
            the partner fixes the file rather than losing referrals in it. */}
        {parsed && !parsed.valid && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-xs font-medium text-red-700 mb-1.5">
              {parsed.errors.length === 1
                ? 'This file needs a fix before you can submit it:'
                : `${parsed.errors.length} problems to fix before you can submit:`}
            </p>
            <div className="max-h-40 overflow-y-auto">
              {parsed.errors.slice(0, 15).map(err => (
                <p key={err} className="text-[11px] text-red-600 leading-relaxed">{err}</p>
              ))}
              {parsed.errors.length > 15 && (
                <p className="text-[11px] text-red-500 mt-1">
                  …and {parsed.errors.length - 15} more
                </p>
              )}
            </div>
          </div>
        )}

        {tooMany && (
          <p className="text-xs text-red-500">
            That file has {parsed?.rows.length} referrals — the limit is {MAX_ENTRIES} per submission.
          </p>
        )}

        {/* Preview */}
        {parsed?.valid && parsed.rows.length > 0 && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
            <p className="text-xs font-medium text-gray-700 mb-2">Preview</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {parsed.rows.slice(0, 25).map(r => (
                <div key={r.email} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-gray-600 truncate">{r.name ?? '—'}</span>
                  <span className="text-gray-400 truncate">{r.email}</span>
                </div>
              ))}
              {parsed.rows.length > 25 && (
                <p className="text-[11px] text-gray-400 pt-1">…and {parsed.rows.length - 25} more</p>
              )}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="referral-note" className="block text-xs font-medium text-gray-600 mb-1">
            Note for the team
          </label>
          <input
            id="referral-note"
            className={field}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Where you met them, anything useful…"
          />
        </div>

        <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
          <p className="text-[11px] text-gray-500">
            The LinkUp team reviews your list and adds each referral to your account at your agreed
            commission rate. Anyone already attributed to another partner is skipped — you&apos;ll see
            the reason per person.
          </p>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="w-full py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-40 transition-colors"
        >
          {submitting
            ? 'Submitting…'
            : parsed?.valid
            ? `Submit ${parsed.rows.length} referral${parsed.rows.length !== 1 ? 's' : ''}`
            : 'Submit referrals'}
        </button>
      </div>
    </AdminCard>
  )
}
