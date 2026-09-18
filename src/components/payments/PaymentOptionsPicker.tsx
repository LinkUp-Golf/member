'use client'

// Which ways a venue takes payment — the checkbox pair behind
// courses.payment_options. Shared by the admin course form and the host event
// form, which set the same column and must not describe it differently.
//
// At least one stays ticked: unticking the last is ignored rather than allowed
// and then refused on save, because a venue with no way to pay can't be booked.

import { cn } from '@/lib/utils'
import {
  PAYMENT_OPTIONS,
  PAYMENT_OPTION_HINTS,
  PAYMENT_OPTION_LABELS,
  type PaymentOption,
} from '@/lib/bookings/payment-options'

export default function PaymentOptionsPicker({
  value,
  onChange,
  disabled = false,
  tone = 'neutral',
  idPrefix = 'payment-option',
}: {
  value: PaymentOption[]
  onChange: (next: PaymentOption[]) => void
  disabled?: boolean
  /** 'member' matches the member app's navy-on-cream forms. */
  tone?: 'neutral' | 'member'
  idPrefix?: string
}) {
  const toggle = (option: PaymentOption) => {
    const on = value.includes(option)
    if (on && value.length === 1) return
    const next = on ? value.filter(o => o !== option) : [...value, option]
    onChange(PAYMENT_OPTIONS.filter(o => next.includes(o)))
  }

  return (
    <div className="space-y-1.5">
      {PAYMENT_OPTIONS.map(option => {
        const on = value.includes(option)
        const id = `${idPrefix}-${option}`
        return (
          <label
            key={option}
            htmlFor={id}
            className={cn(
              'flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer',
              tone === 'member' ? 'border-green-900/10' : 'border-gray-200',
              disabled && 'opacity-60 cursor-not-allowed',
            )}
          >
            <input
              id={id}
              type="checkbox"
              checked={on}
              disabled={disabled || (on && value.length === 1)}
              onChange={() => toggle(option)}
              className={cn(
                'mt-0.5 h-4 w-4 rounded text-green-900 focus:ring-green-800',
                tone === 'member' ? 'border-green-900/30' : 'border-gray-300',
              )}
            />
            <span
              className={cn(
                'min-w-0 block text-sm',
                tone === 'member' ? 'text-green-900/80' : 'text-gray-700',
              )}
            >
              {PAYMENT_OPTION_LABELS[option]}
              <span
                className={cn(
                  'block text-[11px] mt-0.5',
                  tone === 'member' ? 'text-green-900/45' : 'text-gray-400',
                )}
              >
                {PAYMENT_OPTION_HINTS[option]}
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
