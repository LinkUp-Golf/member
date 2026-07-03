'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useForm, Controller } from 'react-hook-form'
import Image from 'next/image'
import {
  AdminPageHeader, AdminButton, Badge, StatCard,
} from '@/components/admin/AdminUI'
import Select from '@/components/ui/Select'
import MediaUpload from '@/components/ui/MediaUpload'
import type { Course, CourseApprovalStatus } from '@/types'

type FilterTab = 'pending' | 'active' | 'rejected' | 'archived'

const STATUS_META: Record<CourseApprovalStatus, { label: string; colour: 'green' | 'yellow' | 'red' | 'gray' }> = {
  pending:  { label: 'Pending',  colour: 'yellow' },
  active:   { label: 'Active',   colour: 'green'  },
  rejected: { label: 'Rejected', colour: 'red'    },
  archived: { label: 'Archived', colour: 'gray'   },
}

const FILTER_LABELS: Record<FilterTab, string> = {
  pending:  'Pending',
  active:   'Active',
  rejected: 'Rejected',
  archived: 'Archived',
}

const TIMEZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago',
  'America/New_York', 'America/Phoenix', 'Pacific/Honolulu',
]

interface CourseRow extends Course {
  requester?: { first_name: string; last_name: string } | null
}


function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function DotsVertical() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  )
}

function CourseMenuItem({ label, danger, disabled, onClick }: { label: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
      style={{ color: danger ? '#dc2626' : '#1a2e1a' }}
    >
      {label}
    </button>
  )
}

// Portaled to document.body (not rendered inline) so the dropdown can
// escape the .card list's overflow-hidden clip; position is measured
// from the trigger button via getBoundingClientRect, same approach as
// the shared Select component.
function CourseActionsMenu({ children }: { children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const MENU_WIDTH = 160

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const openUp = window.innerHeight - rect.bottom < 220
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8)
    setCoords(
      openUp
        ? { bottom: window.innerHeight - rect.top + 4, left }
        : { top: rect.bottom + 4, left }
    )
  }, [])

  const close = useCallback(() => setOpen(false), [])

  const toggle = useCallback(() => {
    if (!open) updatePosition()
    setOpen(o => !o)
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, close])

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  return (
    <div className="relative flex-shrink-0 sm:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label="Course actions"
        className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <DotsVertical />
      </button>

      {open && coords && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-50 rounded-xl shadow-lg border border-gray-100 overflow-hidden bg-white"
            style={{ top: coords.top, bottom: coords.bottom, left: coords.left, width: MENU_WIDTH }}
          >
            {children(close)}
          </div>,
          document.body
        )}
    </div>
  )
}

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<CourseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('pending')
  const [processing, setProcessing] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingCourse, setEditingCourse] = useState<CourseRow | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const loadCourses = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/courses')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) showToast(json.error ?? 'Failed to load courses.', false)
    setCourses(Array.isArray(json.courses) ? json.courses : [])
    setLoading(false)
  }, [])

  useEffect(() => { loadCourses() }, [loadCourses])

  async function approveCourse(course: CourseRow) {
    setProcessing(course.id)
    const res = await fetch(`/api/admin/courses/${course.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) showToast('Course approved' + (json.course?.ghl_calendar_id ? ' — GHL calendar created.' : '.'))
    else showToast(json.error ?? 'Approval failed.', false)
    await loadCourses()
    setProcessing(null)
  }

  async function rejectCourse(course: CourseRow) {
    if (!rejectReason.trim()) { showToast('Please enter a rejection reason.', false); return }
    setProcessing(course.id)
    const res = await fetch(`/api/admin/courses/${course.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', rejection_reason: rejectReason.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) { showToast('Course rejected.'); setRejectingId(null); setRejectReason('') }
    else showToast(json.error ?? 'Rejection failed.', false)
    await loadCourses()
    setProcessing(null)
  }

  async function deleteCourse(course: CourseRow) {
    setProcessing(course.id)
    const res = await fetch(`/api/admin/courses/${course.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      showToast('Course deleted.')
      setDeletingId(null)
    } else {
      // Surface each blocking reason separately so admin knows what to fix
      const reasons: string[] = json.reasons ?? []
      if (reasons.length) {
        showToast(`Cannot delete: ${reasons[0]}`, false)
      } else {
        showToast(json.error ?? 'Delete failed.', false)
      }
    }
    await loadCourses()
    setProcessing(null)
  }

  async function toggleActive(course: CourseRow, active: boolean) {
    setProcessing(course.id)
    const res = await fetch(`/api/admin/courses/${course.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approval_status: active ? 'archived' : 'active' }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) showToast(active ? 'Course archived.' : 'Course reactivated.')
    else showToast(json.error ?? 'Update failed.', false)
    await loadCourses()
    setProcessing(null)
  }

  const grouped = {
    pending:  courses.filter(c => c.approval_status === 'pending'),
    active:   courses.filter(c => c.approval_status === 'active'),
    rejected: courses.filter(c => c.approval_status === 'rejected'),
    archived: courses.filter(c => c.approval_status === 'archived'),
  }
  const filtered = grouped[filter]

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <AdminPageHeader
          title="Courses"
          description="Manage bookable golf courses and their GHL calendars"
        />
        <button
          onClick={() => { setEditingCourse(null); setShowCreate(true) }}
          className="flex-shrink-0 px-4 py-2 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 transition-colors"
        >
          + Add Course
        </button>
      </div>

      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard label="Pending"  value={grouped.pending.length}  sub="Awaiting approval" colour="blue" />
          <StatCard label="Active"   value={grouped.active.length}   sub="Bookable"           colour="green" />
          <StatCard label="Rejected" value={grouped.rejected.length} sub="Declined"           colour="gray" />
          <StatCard label="Archived" value={grouped.archived.length} sub="Closed"             colour="gray" />
        </div>
      )}

      <div className="flex gap-1.5 mb-5 flex-wrap">
        {(Object.keys(FILTER_LABELS) as FilterTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === tab
                ? 'bg-green-900 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {FILTER_LABELS[tab]}
            {grouped[tab].length > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                filter === tab ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                {grouped[tab].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">{[1,2,3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">⛳</p>
          <p className="text-lg font-semibold text-gray-700 mb-1">No {FILTER_LABELS[filter].toLowerCase()} courses</p>
          <p className="text-sm text-gray-400">{filter === 'pending' ? 'Nothing awaiting review.' : 'None yet.'}</p>
          {filter === 'active' && (
            <button onClick={() => { setEditingCourse(null); setShowCreate(true) }} className="mt-4 px-4 py-2 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800">
              Add your first course
            </button>
          )}
        </div>
      ) : (
        <div className="card">
          {filtered.map((course, i) => {
            const sm = STATUS_META[course.approval_status]
            const isProcessing = processing === course.id
            const isRejecting = rejectingId === course.id

            return (
              <div
                key={course.id}
                className="flex items-start gap-3 px-4 py-4"
                style={{ borderBottom: i < filtered.length - 1 ? '1px solid rgba(0,38,105,0.06)' : 'none' }}
              >
                {/* Venue logo — fixed square, pinned to the top like the
                    member booking card, so it never stretches with content. */}
                <div
                  className="relative w-24 h-24 aspect-square self-start rounded-xl overflow-hidden flex-shrink-0"
                  style={{ background: 'rgba(0,38,105,0.03)' }}
                >
                  <Image src={course.logo_url} alt="" fill unoptimized className="object-contain" />
                </div>

                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate min-w-0">{course.name}</h3>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {course.approval_status !== 'active' && (
                          <Badge label={sm.label} colour={sm.colour} />
                        )}
                        {course.ghl_calendar_id && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">Calendar ✓</span>
                        )}
                        {course.ghl_group_id && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium">Group ✓</span>
                        )}
                      </div>
                    </div>

                    {/* Mobile-only 3-dot actions menu — portaled so it can't
                        be clipped by the .card container's overflow-hidden */}
                    <CourseActionsMenu>
                      {(closeMenu) => (
                        <>
                          {course.approval_status === 'pending' && !isRejecting && (
                            <>
                              <CourseMenuItem label={isProcessing ? 'Approving…' : 'Approve'} disabled={isProcessing} onClick={() => { approveCourse(course); closeMenu() }} />
                              <CourseMenuItem label="Reject" danger disabled={isProcessing} onClick={() => { setRejectingId(course.id); setRejectReason(''); closeMenu() }} />
                            </>
                          )}
                          {course.approval_status === 'active' && (
                            <CourseMenuItem label={isProcessing ? '…' : 'Archive'} disabled={isProcessing} onClick={() => { toggleActive(course, true); closeMenu() }} />
                          )}
                          {course.approval_status === 'archived' && (
                            <CourseMenuItem label={isProcessing ? '…' : 'Reactivate'} disabled={isProcessing} onClick={() => { toggleActive(course, false); closeMenu() }} />
                          )}
                          <CourseMenuItem label="Edit" disabled={isProcessing} onClick={() => { setEditingCourse(course); setShowCreate(true); closeMenu() }} />
                          <CourseMenuItem label="Delete" danger disabled={isProcessing} onClick={() => { setDeletingId(course.id); closeMenu() }} />
                        </>
                      )}
                    </CourseActionsMenu>
                  </div>

                  {(course.city || course.state || course.address) && (
                    <p className="text-xs text-gray-500">
                      📍 {[course.city, course.state].filter(Boolean).join(', ')}
                      {course.address ? ` - ${course.address}` : ''}
                    </p>
                  )}

                  {course.cost_per_player != null && (
                    <p className="text-xs font-bold text-gray-700">${course.cost_per_player}/player</p>
                  )}

                  {/* GHL access tags */}
                  <div className="flex flex-wrap gap-1">
                    {(course.required_tags ?? []).length > 0
                      ? (course.required_tags ?? []).map(t => (
                          <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                            {t}
                          </span>
                        ))
                      : <span className="text-[10px] text-gray-400 italic">No access tags</span>
                    }
                  </div>

                  {course.approval_status === 'active' && !course.ghl_calendar_id && (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">
                      ⚠️ No GHL calendar configured — members cannot book this course yet.
                    </p>
                  )}

                  {course.approval_status === 'active' && !course.payment_url && (
                    <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">
                      ⚠️ No payment link configured — members cannot pay for confirmed bookings yet.
                    </p>
                  )}

                  {course.requester && (
                    <p className="text-xs text-gray-400">
                      Requested by <span className="font-medium text-gray-600">{course.requester.first_name} {course.requester.last_name}</span>
                    </p>
                  )}

                  {course.rejection_reason && (
                    <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">Reason: {course.rejection_reason}</p>
                  )}

                  {isRejecting && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Rejection reason (required)"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 outline-none focus:border-red-300"
                      />
                      <button onClick={() => rejectCourse(course)} disabled={isProcessing || !rejectReason.trim()} className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-medium disabled:opacity-50">
                        {isProcessing ? '…' : 'Confirm'}
                      </button>
                      <button onClick={() => { setRejectingId(null); setRejectReason('') }} className="px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-600">Cancel</button>
                    </div>
                  )}

                  {/* Actions — desktop only; mobile uses the 3-dot menu above */}
                  <div className="hidden sm:flex items-center justify-end gap-1.5 flex-wrap pt-1">
                    {course.approval_status === 'pending' && !isRejecting && (
                      <>
                        <AdminButton label={isProcessing ? 'Approving…' : 'Approve'} onClick={() => approveCourse(course)} variant="primary" size="sm" disabled={isProcessing} />
                        <AdminButton label="Reject" onClick={() => { setRejectingId(course.id); setRejectReason('') }} variant="danger" size="sm" disabled={isProcessing} />
                      </>
                    )}
                    {course.approval_status === 'active' && (
                      <AdminButton label={isProcessing ? '…' : 'Archive'} onClick={() => toggleActive(course, true)} variant="ghost" size="sm" disabled={isProcessing} />
                    )}
                    {course.approval_status === 'archived' && (
                      <AdminButton label={isProcessing ? '…' : 'Reactivate'} onClick={() => toggleActive(course, false)} variant="ghost" size="sm" disabled={isProcessing} />
                    )}
                    <AdminButton label="Edit" onClick={() => { setEditingCourse(course); setShowCreate(true) }} variant="ghost" size="sm" disabled={isProcessing} />
                    <AdminButton label="Delete" onClick={() => setDeletingId(course.id)} variant="danger" size="sm" disabled={isProcessing} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <CreateCourseDrawer
          editingCourse={editingCourse}
          onClose={() => { setShowCreate(false); setEditingCourse(null) }}
          onCreated={() => { setShowCreate(false); setEditingCourse(null); loadCourses(); showToast(editingCourse ? 'Course updated successfully.' : 'Course added successfully.') }}
          onError={(msg) => showToast(msg, false)}
        />
      )}

      {deletingId && (
        <DeleteCourseModal
          course={courses.find(c => c.id === deletingId) ?? null}
          processing={!!processing}
          onConfirm={() => {
            const course = courses.find(c => c.id === deletingId)
            if (course) deleteCourse(course)
          }}
          onClose={() => setDeletingId(null)}
        />
      )}
    </div>
  )
}

// ---- Delete confirmation modal ------------------------------

function DeleteCourseModal({
  course,
  processing,
  onConfirm,
  onClose,
}: {
  course: CourseRow | null
  processing: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  if (!course) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        {/* Icon */}
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4 mx-auto">
          <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-gray-900 text-center mb-2">Delete Course</h2>
        <p className="text-sm text-gray-500 text-center mb-1">
          You&apos;re about to permanently delete
        </p>
        <p className="text-sm font-semibold text-gray-800 text-center mb-4">
          &ldquo;{course.name}&rdquo;
        </p>

        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-6">
          <p className="text-xs text-amber-700 font-medium mb-1">Before deleting, ensure:</p>
          <ul className="text-xs text-amber-600 space-y-1 list-disc list-inside">
            <li>No pending or past bookings exist for this course</li>
            <li>No members have this as their home course</li>
          </ul>
          <p className="text-[11px] text-amber-500 mt-2">If the course has any booking history, deletion will be blocked — use Archive instead.</p>
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
            {processing ? 'Deleting…' : 'Delete Course'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Booking rule display helpers ---------------------------
function formatMins(mins: number | null): string {
  if (!mins) return '—'
  if (mins % (60 * 24 * 30) === 0) return `${mins / (60 * 24 * 30)} month${mins / (60 * 24 * 30) !== 1 ? 's' : ''}`
  if (mins % (60 * 24 * 7) === 0)  return `${mins / (60 * 24 * 7)} week${mins / (60 * 24 * 7) !== 1 ? 's' : ''}`
  if (mins % (60 * 24) === 0)      return `${mins / (60 * 24)} day${mins / (60 * 24) !== 1 ? 's' : ''}`
  if (mins % 60 === 0)             return `${mins / 60} hr${mins / 60 !== 1 ? 's' : ''}`
  return `${mins} min${mins !== 1 ? 's' : ''}`
}
function formatDays(days: number | null): string {
  if (!days) return '—'
  if (days % 30 === 0) return `${days / 30} month${days / 30 !== 1 ? 's' : ''}`
  if (days % 7 === 0)  return `${days / 7} week${days / 7 !== 1 ? 's' : ''}`
  return `${days} day${days !== 1 ? 's' : ''}`
}

type CourseFormValues = {
  name: string
  slug: string        // hidden — auto-generated from name
  logo_url: string
  city: string        // stores full one-line location
  address: string
  phone: string
  map_link: string
  timezone: string
  ghl_calendar_id: string
  cost_per_player: number | ''
  booking_rules: string
  booking_url: string
  payment_url: string
  required_tags: string[]
}

function CreateCourseDrawer({ editingCourse, onClose, onCreated, onError }: {
  editingCourse?: Course | null
  onClose: () => void
  onCreated: () => void
  onError: (msg: string) => void
}) {
  const isEdit = !!editingCourse

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CourseFormValues>({
    defaultValues: {
      name: editingCourse?.name ?? '',
      slug: editingCourse?.slug ?? '',
      logo_url: editingCourse?.logo_url ?? '',
      city: editingCourse?.city ?? '',
      address: editingCourse?.address ?? '',
      phone: editingCourse?.phone ?? '',
      map_link: editingCourse?.map_link ?? '',
      timezone: editingCourse?.timezone ?? 'America/Los_Angeles',
      ghl_calendar_id: editingCourse?.ghl_calendar_id ?? '',
      cost_per_player: editingCourse?.cost_per_player ?? '',
      booking_rules: editingCourse?.booking_rules ?? '',
      booking_url: editingCourse?.booking_url ?? '',
      payment_url: editingCourse?.payment_url ?? '',
      required_tags: editingCourse?.required_tags ?? [],
    },
  })

  const watchedName = watch('name')
  const watchedCalendarId = watch('ghl_calendar_id')

  // Auto-generate slug from course name in create mode
  useEffect(() => {
    if (!isEdit) setValue('slug', toSlug(watchedName), { shouldValidate: !!watchedName })
  }, [watchedName, isEdit, setValue])

  // GHL data
  type GHLCal = { id: string; name: string; calendarType: string; slotInterval: number | null; slotDuration: number | null; preBuffer: number | null; slotBuffer: number | null; appoinmentPerSlot: number | null; allowBookingAfter: number | null; allowBookingFor: number | null }
  const [ghlTags, setGhlTags] = useState<{ id: string; name: string }[]>([])
  const [ghlCalendars, setGhlCalendars] = useState<GHLCal[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [calsLoading, setCalsLoading] = useState(true)
  const [tagSearch, setTagSearch] = useState('')

  useEffect(() => {
    fetch('/api/admin/ghl/tags').then(r => r.json()).then(d => setGhlTags(d.tags ?? [])).catch(() => setGhlTags([])).finally(() => setTagsLoading(false))
    const calParams = new URLSearchParams()
    if (editingCourse?.ghl_group_id) calParams.set('groupId', editingCourse.ghl_group_id)
    if (editingCourse?.id) calParams.set('excludeCourseId', editingCourse.id)
    const calUrl = `/api/admin/ghl/calendars${calParams.toString() ? `?${calParams}` : ''}`
    fetch(calUrl).then(r => r.json()).then(d => setGhlCalendars(d.calendars ?? [])).catch(() => setGhlCalendars([])).finally(() => setCalsLoading(false))
  }, [editingCourse?.ghl_group_id, editingCourse?.id])

  const selectedCalendar = ghlCalendars.find(c => c.id === watchedCalendarId) ?? null

  const filteredTags = tagSearch.trim()
    ? ghlTags.filter(t => t.name.toLowerCase().includes(tagSearch.toLowerCase()))
    : ghlTags

  async function onSubmit(data: CourseFormValues) {
    const url = isEdit ? `/api/admin/courses/${editingCourse!.id}` : '/api/admin/courses'
    try {
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          cost_per_player: data.cost_per_player === '' ? null : Number(data.cost_per_player),
          createCalendar: false,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) onCreated()
      else onError(json.error ?? (isEdit ? 'Failed to update course' : 'Failed to create course'))
    } catch {
      onError('Network error. Check your connection and try again.')
    }
  }

  // Input styling helpers
  const field = (hasError: boolean) =>
    `w-full px-3 py-2 text-sm rounded-xl border outline-none transition-colors bg-white ${hasError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-green-700'}`
  const triggerCls = (hasError: boolean) =>
    `${field(hasError)} flex items-center justify-between gap-2`
  const labelCls = "block text-xs font-medium text-gray-600 mb-1"
  const errMsg = "text-xs text-red-500 mt-1"
  const infoText = "text-[11px] text-gray-400 mt-1"

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-xl h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? 'Edit Course' : 'Add Course'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto px-6 py-6 space-y-6" noValidate>

          {/* ---- Course Info ---- */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">Course Info</h3>
            <div className="space-y-4">

              <Controller
                name="logo_url"
                control={control}
                rules={{ validate: v => !!v || 'A venue logo is required' }}
                render={({ field: f }) => (
                  <div>
                    <MediaUpload
                      label="Venue Logo *"
                      value={f.value || null}
                      onChange={url => f.onChange(url ?? '')}
                      mediaType="image"
                      folder="course-logos"
                      hasError={!!errors.logo_url}
                    />
                    {errors.logo_url && <p className={errMsg}>{errors.logo_url.message}</p>}
                  </div>
                )}
              />

              <div>
                <label htmlFor="course-name" className={labelCls}>Course Name *</label>
                <input
                  id="course-name"
                  className={field(!!errors.name)}
                  placeholder="Country Club of Rancho Bernardo"
                  {...register('name', { required: 'Course name is required' })}
                />
                {errors.name && <p className={errMsg}>{errors.name.message}</p>}
              </div>

              {/* Slug is auto-generated from name — not shown to admin */}
              <input type="hidden" {...register('slug')} />

              <div>
                <label htmlFor="course-city" className={labelCls}>Location *</label>
                <input
                  id="course-city"
                  className={field(!!errors.city)}
                  placeholder="7447 Batiquitos Dr, Carlsbad, CA 92011"
                  {...register('city', { required: 'Location is required' })}
                />
                {errors.city && <p className={errMsg}>{errors.city.message}</p>}
              </div>

              <div>
                <label htmlFor="course-address" className={labelCls}>Address</label>
                <input
                  id="course-address"
                  className={field(false)}
                  placeholder="Street address"
                  {...register('address')}
                />
              </div>

              <div>
                <label htmlFor="course-phone" className={labelCls}>Phone</label>
                <input
                  id="course-phone"
                  type="tel"
                  className={field(false)}
                  placeholder="(760) 555-0100"
                  {...register('phone')}
                />
              </div>

              <div>
                <label htmlFor="course-map-link" className={labelCls}>Map Link</label>
                <input
                  id="course-map-link"
                  type="url"
                  className={field(!!errors.map_link)}
                  placeholder="https://maps.google.com/…"
                  {...register('map_link', {
                    validate: v => !v || /^https?:\/\/.+/.test(v) || 'Must be a valid URL (https://…)',
                  })}
                />
                {errors.map_link && <p className={errMsg}>{errors.map_link.message}</p>}
              </div>

              <div>
                <label htmlFor="course-timezone" className={labelCls}>Timezone</label>
                <Controller
                  name="timezone"
                  control={control}
                  render={({ field: f }) => (
                    <Select
                      id="course-timezone"
                      options={TIMEZONES.map(tz => ({ value: tz, label: tz }))}
                      value={f.value}
                      onChange={f.onChange}
                      placeholder="Select timezone…"
                      searchPlaceholder="Search timezones…"
                      triggerClassName={triggerCls(false)}
                    />
                  )}
                />
              </div>
            </div>
          </section>

          {/* ---- Access & Pricing ---- */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">Access &amp; Pricing</h3>
            <div className="space-y-4">

              {/* GHL Access Tags — Controller-managed array with min-1 validation */}
              <Controller
                name="required_tags"
                control={control}
                rules={{ validate: v => v.length > 0 || 'At least one GHL access tag is required' }}
                render={({ field: f }) => (
                  <div>
                    {/* Not a native <label> — this heads a checkbox group, not
                        a single control, so it can't be associated via htmlFor. */}
                    <p className={labelCls}>GHL Access Tags *</p>
                    <p className={`${infoText} mb-2`}>Members with at least one of these tags can access and book this course.</p>

                    {f.value.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {f.value.map((t: string) => (
                          <span key={t} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-800 font-medium">
                            {t}
                            <button type="button"
                              onClick={() => f.onChange(f.value.filter((x: string) => x !== t))}
                              className="text-green-600 hover:text-red-500 ml-0.5">✕</button>
                          </span>
                        ))}
                      </div>
                    )}

                    {tagsLoading ? (
                      <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
                    ) : ghlTags.length === 0 ? (
                      <p className="text-xs text-gray-400">No tags found in GHL.</p>
                    ) : (
                      <div className={`border rounded-xl overflow-hidden ${errors.required_tags ? 'border-red-400' : 'border-gray-200'}`}>
                        <input
                          type="text"
                          placeholder="Search tags…"
                          value={tagSearch}
                          onChange={e => setTagSearch(e.target.value)}
                          className="w-full px-3 py-2 text-sm border-b border-gray-200 outline-none focus:border-green-700"
                        />
                        <div className="max-h-44 overflow-y-auto">
                          {filteredTags.length === 0
                            ? <p className="px-3 py-2 text-xs text-gray-400">No matches</p>
                            : filteredTags.map(t => (
                                <label key={t.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={f.value.includes(t.name)}
                                    onChange={() => f.onChange(
                                      f.value.includes(t.name)
                                        ? f.value.filter((x: string) => x !== t.name)
                                        : [...f.value, t.name]
                                    )}
                                    className="rounded text-green-700"
                                  />
                                  <span className="text-sm text-gray-700">{t.name}</span>
                                </label>
                              ))
                          }
                        </div>
                      </div>
                    )}
                    {errors.required_tags && <p className={errMsg}>{errors.required_tags.message as string}</p>}
                  </div>
                )}
              />

              <div>
                <label htmlFor="course-cost-per-player" className={labelCls}>Cost per player (USD) *</label>
                <input
                  id="course-cost-per-player"
                  type="number"
                  min="0"
                  step="0.01"
                  className={field(!!errors.cost_per_player)}
                  placeholder="160"
                  {...register('cost_per_player', {
                    required: 'Cost per player is required',
                    min: { value: 0, message: 'Must be 0 or more' },
                  })}
                />
                {errors.cost_per_player && <p className={errMsg}>{errors.cost_per_player.message}</p>}
              </div>

              <div>
                <label htmlFor="course-booking-rules" className={labelCls}>Booking Rules</label>
                <textarea id="course-booking-rules" className={`${field(false)} min-h-[80px] resize-y`} placeholder="Cancellation policy, dress code…" {...register('booking_rules')} />
              </div>

              <div>
                <label htmlFor="course-booking-url" className={labelCls}>Website</label>
                <input
                  id="course-booking-url"
                  type="url"
                  className={field(!!errors.booking_url)}
                  placeholder="https://your-booking-site.com/event"
                  {...register('booking_url', {
                    validate: v => !v || /^https?:\/\/.+/.test(v) || 'Must be a valid URL (https://…)',
                  })}
                />
                {errors.booking_url
                  ? <p className={errMsg}>{errors.booking_url.message}</p>
                  : <p className={infoText}>Optional website link shown to members (opens in new tab).</p>
                }
              </div>

              <div>
                <label htmlFor="payment_url" className={labelCls}>Payment Link *</label>
                <input
                  id="payment_url"
                  type="url"
                  className={field(!!errors.payment_url)}
                  placeholder="https://linkupgolf-services.com/event-checkout-page"
                  {...register('payment_url', {
                    required: 'Payment link is required',
                    validate: v => /^https?:\/\/.+/.test(v) || 'Must be a valid URL (https://…)',
                  })}
                />
                {errors.payment_url
                  ? <p className={errMsg}>{errors.payment_url.message}</p>
                  : <p className={infoText}>Members are sent here to pay for confirmed bookings.</p>
                }
              </div>
            </div>
          </section>

          {/* ---- GHL Calendar ---- */}
          <section>
            <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">GHL Calendar</h3>
            {!isEdit ? (
              <div className="mb-4 rounded-xl bg-purple-50 border border-purple-100 px-4 py-3">
                <p className="text-xs font-semibold text-purple-700 mb-0.5">GHL Calendar Group will be created</p>
                <p className="text-[11px] text-purple-600">Saving this course auto-creates a Calendar Group in GHL named after the course. You can then add calendars to that group in GHL and link them here.</p>
              </div>
            ) : editingCourse?.ghl_group_id ? (
              <div className="mb-4 rounded-xl bg-green-50 border border-green-100 px-4 py-3">
                <p className="text-xs font-semibold text-green-700 mb-0.5">Calendars filtered to this course&apos;s GHL group</p>
                <p className="text-[11px] text-green-600">Showing only calendars in this course&apos;s GHL Calendar Group.</p>
              </div>
            ) : (
              <p className={`${infoText} mb-3`}>Select the GHL calendar to use for this course. Booking rules are read from the calendar settings in GHL.</p>
            )}

            {calsLoading ? (
              <div className="h-9 bg-gray-100 rounded-xl animate-pulse" />
            ) : ghlCalendars.length === 0 ? (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
                <p className="text-xs font-semibold text-amber-700">
                  {isEdit && editingCourse?.ghl_calendar_id
                    ? '⚠️ Assigned calendar not found in GHL'
                    : 'No class booking calendars found in GHL'}
                </p>
                <p className="text-[11px] text-amber-600 mt-0.5">
                  {isEdit && editingCourse?.ghl_calendar_id
                    ? 'The previously assigned calendar may have been deleted. Edit and save to clear it, then assign a new one — members cannot book until this is fixed.'
                    : 'No Class Booking type calendars exist yet. Create one in GHL first.'}
                </p>
              </div>
            ) : (
              <Controller
                name="ghl_calendar_id"
                control={control}
                render={({ field: f }) => (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <Select
                          options={ghlCalendars.map(c => ({ value: c.id, label: `${c.name} (${c.calendarType})` }))}
                          value={f.value}
                          onChange={f.onChange}
                          placeholder="Select a GHL calendar…"
                          searchPlaceholder="Search calendars…"
                          triggerClassName={triggerCls(!!errors.ghl_calendar_id)}
                        />
                      </div>
                      {f.value && (
                        <button
                          type="button"
                          onClick={() => f.onChange('')}
                          className="flex-shrink-0 text-xs text-gray-400 hover:text-red-500 px-2 py-2"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {errors.ghl_calendar_id && <p className={errMsg}>{errors.ghl_calendar_id.message}</p>}
                  </>
                )}
              />
            )}

            {selectedCalendar && (
              <div className="mt-4 rounded-xl border border-gray-100 overflow-hidden">
                <p className="text-xs font-semibold text-gray-500 px-4 pt-3 pb-2 bg-gray-50 border-b border-gray-100">
                  Booking Rules — from GHL
                </p>
                <div className="grid grid-cols-2 divide-x divide-y divide-gray-100">
                  {[
                    { label: 'Meeting interval',      value: formatMins(selectedCalendar.slotInterval) },
                    { label: 'Meeting duration',      value: formatMins(selectedCalendar.slotDuration) },
                    { label: 'Min scheduling notice', value: formatMins(selectedCalendar.allowBookingAfter) },
                    { label: 'Date range',            value: formatDays(selectedCalendar.allowBookingFor) },
                    { label: 'Pre-buffer',            value: formatMins(selectedCalendar.preBuffer) },
                    { label: 'Post-buffer',           value: formatMins(selectedCalendar.slotBuffer) },
                    { label: 'Seats per class',       value: selectedCalendar.appoinmentPerSlot ? `${selectedCalendar.appoinmentPerSlot}` : 'Unlimited' },
                  ].map(({ label, value }) => (
                    <div key={label} className="px-4 py-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">{label}</p>
                      <p className="text-sm font-medium text-gray-700">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <button type="submit" disabled={isSubmitting} className="w-full py-3 rounded-xl bg-green-900 text-white font-semibold hover:bg-green-800 disabled:opacity-50 transition-colors">
            {isSubmitting ? (isEdit ? 'Saving…' : 'Adding course…') : (isEdit ? 'Save Changes' : 'Add Course')}
          </button>
        </form>
      </div>
    </div>
  )
}
