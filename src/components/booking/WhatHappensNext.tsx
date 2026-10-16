import { whatHappensNext } from "@/lib/bookings/invitations";

/**
 * "What happens next" after a booking — on the booking confirmation, and on an
 * added player's invitation, where the payment step reads "Arrive and play"
 * when the booker is covering them. The steps come from whatHappensNext.
 */
export default function WhatHappensNext({
  paidByBooker = false,
}: {
  paidByBooker?: boolean;
}) {
  return (
    <div className="px-1 space-y-2.5">
      <p className="section-label">What happens next</p>
      {whatHappensNext(paidByBooker).map(({ step, detail }, i) => (
        <div key={i} className="flex items-start gap-3">
          <span
            className="flex-shrink-0 w-5 h-5 mt-px rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{
              background: "rgba(133,187,101,0.12)",
              color: "var(--color-green-700)",
            }}
          >
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm" style={{ color: "rgba(0,38,105,0.5)" }}>
              {step}
            </p>
            {detail && (
              <p
                className="text-xs mt-1 leading-relaxed"
                style={{ color: "rgba(0,38,105,0.4)" }}
              >
                {detail}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
