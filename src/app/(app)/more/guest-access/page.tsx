'use client'

import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/auth'
import { apiClient } from '@/lib/api-client'
import { Spinner } from '@/components/ui/Loading'
import AppShell from '@/components/layout/AppShell'
import { formatBookingDate, formatRelativeTime } from '@/lib/utils'
import type { Course, GuestAccessRequest } from '@/types'

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  pending:  { label: 'Pending review', colour: 'text-yellow-600 bg-yellow-50' },
  approved: { label: 'Approved ✓',     colour: 'text-green-700 bg-green-50' },
  denied:   { label: 'Denied',          colour: 'text-red-500 bg-red-50' },
}

export default function GuestAccessPage() {
  const { user } = useAuthStore()
  const [courses, setCourses] = useState<Course[]>([])
  const [requests, setRequests] = useState<GuestAccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    if (user) loadData()
  }, [user])

  async function loadData() {
    const response = await apiClient.get<{ courses: Course[]; requests: GuestAccessRequest[] }>('/api/guest-access')
    if (response.data) {
      setCourses(response.data.courses)
      setRequests(response.data.requests)
    }
    setLoading(false)
  }

  return (
    <AppShell
      header={
        <div className="top-bar flex items-center justify-between">
          <div>
            <div className="logo-text">Guest Access</div>
            <div className="logo-subtitle">Visit another community</div>
          </div>
        </div>
      }
    >
      <div className="px-5 py-5 pb-8">
        {/* Explainer */}
        <div className="card card-pad mb-5">
          <p className="text-sm text-green-900 leading-relaxed">
            When you travel, you can request temporary access to other LinkUp communities.
            Local members will be notified of your visit and can invite you to play.
            Access is granted for your travel dates only.
          </p>
        </div>

        {/* Available courses */}
        {!loading && courses.length === 0 && (
          <div className="text-center py-8">
            <p className="text-3xl mb-3">🌍</p>
            <p className="font-sans font-black text-xl text-green-900 mb-2">More communities coming soon</p>
            <p className="text-sm text-green-900/45">
              Aviara is currently the first LinkUp community. Additional cities will be announced soon.
            </p>
          </div>
        )}

        {!loading && courses.length > 0 && (
          <>
            <p className="section-label mb-3">Available communities</p>
            <div className="card mb-5">
              {courses.map((course, i) => (
                <div
                  key={course.id}
                  className={`px-4 py-3.5 ${i < courses.length - 1 ? 'border-b border-green-900/08' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-green-900">{course.name}</p>
                      <p className="text-xs text-green-900/45 mt-0.5">{course.city}, {course.state}</p>
                    </div>
                    <button
                      onClick={() => setShowForm(true)}
                      className="btn btn-primary btn-sm flex-shrink-0"
                    >
                      Request access
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Request form */}
        {showForm && (
          <GuestAccessForm
            courses={courses}
            onSubmit={async (data) => {
              await apiClient.post('/api/guest-access', {
                target_course_id: data.courseId,
                reason: data.reason,
                visit_from: data.from,
                visit_until: data.until,
              })
              setShowForm(false)
              loadData()
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {/* Past requests */}
        {!loading && requests.length > 0 && (
          <>
            <p className="section-label mb-3">Your requests</p>
            <div className="card">
              {requests.map((r, i) => {
                const s = STATUS_LABELS[r.status] ?? { label: r.status, colour: 'text-green-900/50 bg-green-50' }
                const course = courses.find(c => c.id === r.target_course_id)
                return (
                  <div
                    key={r.id}
                    className={`px-4 py-3.5 ${i < requests.length - 1 ? 'border-b border-green-900/08' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-green-900">
                          {course?.name ?? 'Unknown course'}
                        </p>
                        <p className="text-xs text-green-900/45 mt-0.5">
                          {formatBookingDate(r.visit_from)} → {formatBookingDate(r.visit_until)}
                        </p>
                        <p className="text-xs text-green-900/30 mt-0.5">
                          Requested {formatRelativeTime(r.created_at)}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${s.colour}`}>
                        {s.label}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

// ---- Guest access request form ------------------------------

function GuestAccessForm({
  courses,
  onSubmit,
  onCancel,
}: {
  courses: Course[]
  onSubmit: (data: { courseId: string; reason: string; from: string; until: string }) => Promise<void>
  onCancel: () => void
}) {
  const today = new Date().toISOString().split('T')[0]
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '')
  const [from, setFrom] = useState('')
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!courseId || !from || !until || !reason.trim()) return
    setSubmitting(true)
    await onSubmit({ courseId, reason, from, until })
    setSubmitting(false)
  }

  return (
    <div className="card card-pad mb-5 space-y-4">
      <p className="section-label">Request guest access</p>

      <div>
        <label htmlFor="ga-course" className="text-xs text-green-900/50 mb-1.5 block">Destination community</label>
        <select id="ga-course" className="input" value={courseId} onChange={e => setCourseId(e.target.value)}>
          {courses.map(c => <option key={c.id} value={c.id}>{c.name} — {c.city}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ga-arriving" className="text-xs text-green-900/50 mb-1.5 block">Arriving</label>
          <input id="ga-arriving" type="date" className="input" min={today} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ga-departing" className="text-xs text-green-900/50 mb-1.5 block">Departing</label>
          <input id="ga-departing" type="date" className="input" min={from || today} value={until} onChange={e => setUntil(e.target.value)} />
        </div>
      </div>

      <div>
        <label htmlFor="ga-reason" className="text-xs text-green-900/50 mb-1.5 block">Reason for visit</label>
        <textarea
          id="ga-reason"
          className="input resize-none"
          rows={3}
          placeholder="Business trip, vacation, conference…"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={onCancel} className="btn btn-outline flex-1 justify-center" disabled={submitting}>
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!courseId || !from || !until || !reason.trim() || submitting}
          className="btn btn-gold flex-1 justify-center"
        >
          {submitting ? <Spinner className="w-4 h-4 text-green-900" /> : 'Submit request'}
        </button>
      </div>
    </div>
  )
}

