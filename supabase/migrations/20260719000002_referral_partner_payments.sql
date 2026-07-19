-- Referral commission is paid monthly, by hand, outside the app (bank
-- transfer, etc.). These tables are the record of those payouts: what was
-- owed for a month, what was actually paid, and which conversions it covered.

CREATE TABLE IF NOT EXISTS referral_partner_payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_partner_id  uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  -- The month being paid for, stored as its first day (2026-07-01 = July 2026).
  period_month         date NOT NULL,
  -- What the app calculated was owed, and what the admin actually paid. They
  -- are usually equal; keeping both means an adjustment (a partial payment, a
  -- negotiated top-up) is visible rather than silently overwriting the maths.
  calculated_amount    numeric(10,2) NOT NULL,
  amount               numeric(10,2) NOT NULL CHECK (amount >= 0),
  conversion_count     integer NOT NULL DEFAULT 0,
  note                 text,
  paid_at              timestamptz NOT NULL DEFAULT now(),
  paid_by              uuid REFERENCES members(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- A month is paid once per partner. This is the guard against double-paying
-- from a double-submit or two admins working the same payout run.
ALTER TABLE referral_partner_payments
  DROP CONSTRAINT IF EXISTS referral_partner_payments_period_unique;
ALTER TABLE referral_partner_payments
  ADD CONSTRAINT referral_partner_payments_period_unique
  UNIQUE (referral_partner_id, period_month);

CREATE INDEX IF NOT EXISTS referral_partner_payments_partner_idx
  ON referral_partner_payments (referral_partner_id, period_month DESC);

-- The conversions a payment covered, snapshotted at payout time. Commission is
-- otherwise derived on read from live member rows and the partner's current
-- rate — none of which are stable. Without this, changing a partner's
-- percentage or a member's start date would silently rewrite what a past
-- payment was "for".
CREATE TABLE IF NOT EXISTS referral_partner_payment_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES referral_partner_payments(id) ON DELETE CASCADE,
  -- Nullable: the referral may be unlinked later, but the payout record stands.
  link_id      uuid REFERENCES referral_partner_links(id) ON DELETE SET NULL,
  email        text NOT NULL,
  name         text,
  converted_at date NOT NULL,
  commission   numeric(10,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS referral_partner_payment_items_payment_idx
  ON referral_partner_payment_items (payment_id);

-- A conversion is paid at most once, across all months. Belt-and-braces
-- alongside the period constraint: it also catches a conversion whose date
-- shifts into a month that was already paid.
CREATE UNIQUE INDEX IF NOT EXISTS referral_partner_payment_items_link_unique
  ON referral_partner_payment_items (link_id) WHERE link_id IS NOT NULL;

ALTER TABLE referral_partner_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_partner_payment_items ENABLE ROW LEVEL SECURITY;

-- Admins see everything; a partner sees their own payment history. Recording a
-- payment is a service-role API route, so there is no INSERT policy.
DROP POLICY IF EXISTS "Admins and owners can view referral payments"
  ON referral_partner_payments;
CREATE POLICY "Admins and owners can view referral payments"
  ON referral_partner_payments FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM referral_partners p
      WHERE p.id = referral_partner_payments.referral_partner_id
        AND p.member_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins and owners can view referral payment items"
  ON referral_partner_payment_items;
CREATE POLICY "Admins and owners can view referral payment items"
  ON referral_partner_payment_items FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM referral_partner_payments pay
      JOIN referral_partners p ON p.id = pay.referral_partner_id
      WHERE pay.id = referral_partner_payment_items.payment_id
        AND p.member_id = auth.uid()
    )
  );
