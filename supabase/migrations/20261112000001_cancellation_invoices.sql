-- Late-cancellation fees are invoiced, not charged to a card on file.
--
-- The member is no longer asked for a card when they book. A cancellation
-- inside the window still records its fee before the seat is released (see
-- 20261103000001), and the fee is then issued as a Stripe invoice: emailed to
-- the member as a link to Stripe's invoice page, where they pay by card and can
-- download the invoice as a PDF. Stripe's invoice.paid webhook is what marks it
-- paid; voiding the invoice in the Stripe dashboard marks it waived.
--
-- status, as it now reads:
--   pending  recorded, invoice not issued yet (in flight, or Stripe failed and
--            the member's "Pay invoice" button will issue it).
--   unpaid   invoiced (or due an invoice); waiting on the member.
--   paid     Stripe says the invoice — or, for a fee from the card era, the
--            charge or Checkout payment — was paid.
--   waived   the invoice was voided in Stripe.
--
-- member_payment_methods stays: its stripe_customer_id is the customer every
-- invoice is issued to. Its card columns are no longer written.
-- ------------------------------------------------------------

ALTER TABLE cancellation_fees
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
  -- Stripe's hosted invoice page: where the member pays.
  ADD COLUMN IF NOT EXISTS invoice_url       text,
  ADD COLUMN IF NOT EXISTS invoice_pdf       text,
  ADD COLUMN IF NOT EXISTS invoice_number    text,
  ADD COLUMN IF NOT EXISTS invoiced_at       timestamptz;

-- The webhook finds a fee by its invoice; one invoice per fee.
CREATE UNIQUE INDEX IF NOT EXISTS cancellation_fees_invoice_uidx
  ON cancellation_fees (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
