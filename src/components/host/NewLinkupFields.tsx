'use client'

// The fields of a New LinkUp — rounds at a club we don't have yet.
//
// One component for both places that ask: the New LinkUp tab of the host event
// drawer and the become-a-host application. Controlled, with its rules in
// src/lib/hosts/new-linkup.ts, so the two can't drift into asking different
// things or accepting different answers.

import DateMultiPicker from '@/components/host/DateMultiPicker'
import DateTeeTimeList from '@/components/host/DateTeeTimeList'
import PaymentOptionsPicker from '@/components/payments/PaymentOptionsPicker'
import { cn } from '@/lib/utils'
import {
  NEW_LINKUP_GUESTS_MAX,
  NEW_LINKUP_NAME_MAX,
  NEW_LINKUP_WEBSITE_MAX,
  type NewLinkupErrors,
  type NewLinkupValues,
} from '@/lib/hosts/new-linkup'

export default function NewLinkupFields({
  value,
  onChange,
  errors = {},
  maxDates,
  tone = 'neutral',
  idPrefix = 'new-linkup',
  showPaymentOptions = true,
}: {
  value: NewLinkupValues
  onChange: (next: NewLinkupValues) => void
  errors?: NewLinkupErrors
  /** Cap on dates in one submission. */
  maxDates?: number
  /** 'member' matches the member app's navy-on-cream forms. */
  tone?: 'neutral' | 'member'
  idPrefix?: string
  /** Off where the surrounding form already asks for payment options. */
  showPaymentOptions?: boolean
}) {
  const member = tone === 'member'
  const labelCls = member
    ? 'text-xs text-green-900/50 mb-1.5 block'
    : 'block text-xs font-medium text-gray-600 mb-1'
  const field = member ? 'input' : 'input text-sm'
  const hintCls = cn('text-[11px] mt-1', member ? 'text-green-900/40' : 'text-gray-400')
  const errCls = 'text-xs text-red-500 mt-1'

  const set = (patch: Partial<NewLinkupValues>) => onChange({ ...value, ...patch })

  // Tee times follow their dates, so a date removed takes its tee time with it.
  const setDates = (dates: string[]) =>
    set({
      dates,
      teeTimes: Object.fromEntries(dates.map(d => [d, value.teeTimes[d] ?? ''])),
    })

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-name`} className={labelCls}>
          Event *
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          className={field}
          placeholder="Name of the event you want to host"
          maxLength={NEW_LINKUP_NAME_MAX}
          value={value.name}
          onChange={e => set({ name: e.target.value })}
        />
        {errors.name && <p className={errCls}>{errors.name}</p>}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-website`} className={labelCls}>
          Website
        </label>
        <input
          id={`${idPrefix}-website`}
          type="url"
          className={field}
          placeholder="https://… (optional)"
          maxLength={NEW_LINKUP_WEBSITE_MAX}
          value={value.website}
          onChange={e => set({ website: e.target.value })}
        />
        {errors.website ? (
          <p className={errCls}>{errors.website}</p>
        ) : (
          <p className={hintCls}>Optional, but it saves us looking the event up ourselves.</p>
        )}
      </div>

      <div>
        {/* A span, not a label: the control is a grid of day buttons, so there
            is nothing for a label to point at. */}
        <span className={labelCls}>Dates *</span>
        {/* Real dates, not a description of them — that's what lets each one
            become an event with this host's name on it. Every upcoming day is
            offered: there's no calendar to ask what this venue has open until
            we've set it up. */}
        <DateMultiPicker value={value.dates} onChange={setDates} max={maxDates} />
        <DateTeeTimeList
          dates={value.dates}
          teeTimes={value.teeTimes}
          onTeeTimeChange={(date, t) => set({ teeTimes: { ...value.teeTimes, [date]: t } })}
          onRemove={date => setDates(value.dates.filter(d => d !== date))}
          max={maxDates}
          tone={tone}
          idPrefix={`${idPrefix}-tee`}
        />
        <p className={hintCls}>
          Each date becomes its own event, with its own tee time — type it however
          you like, or leave it blank if there&apos;s no fixed time. We&apos;ll
          confirm them with the venue while we set it up.
        </p>
        {errors.dates && <p className={errCls}>{errors.dates}</p>}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-guests`} className={labelCls}>
          Number of guests *
        </label>
        <input
          id={`${idPrefix}-guests`}
          type="number"
          inputMode="numeric"
          min={1}
          max={NEW_LINKUP_GUESTS_MAX}
          className={field}
          placeholder="e.g. 12"
          value={value.guests}
          onChange={e => set({ guests: e.target.value })}
        />
        {errors.guests && <p className={errCls}>{errors.guests}</p>}
      </div>

      <div>
        <label htmlFor={`${idPrefix}-rate`} className={labelCls}>
          Member guest rate *
        </label>
        <input
          id={`${idPrefix}-rate`}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className={field}
          placeholder="e.g. 150"
          value={value.rate}
          onChange={e => set({ rate: e.target.value })}
        />
        {errors.rate && <p className={errCls}>{errors.rate}</p>}
      </div>

      {showPaymentOptions && (
        <div>
          <span className={labelCls}>Payment options *</span>
          <PaymentOptionsPicker
            value={value.paymentOptions}
            onChange={paymentOptions => set({ paymentOptions })}
            tone={tone}
            idPrefix={`${idPrefix}-payment-option`}
          />
          <p className={hintCls}>Members see these ways to pay when they book this venue.</p>
        </div>
      )}
    </div>
  )
}
