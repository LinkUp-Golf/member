-- Recurring referral commission.
--
-- Commission changes from a one-time payment per converted member to a monthly
-- accrual: a partner earns their rate each month a referred member stays a
-- paying member (up to a 12-month term), stopping the month the member cancels.
-- Payouts become balance-based — a partner is paid once their unpaid balance
-- clears a threshold, and any remainder rolls over.

-- ---- 1. Cancellation date on members ------------------------
-- Stamped when a membership tag disappears from GHL, cleared when it returns.
-- Accrual stops at this month.
ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_ended_at date;

-- ---- 2. Per-partner payout method ---------------------------
ALTER TABLE referral_partners
  ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'cash'
  CHECK (payout_method IN ('cash', 'coupon'));

-- ---- 3. Balance-based payouts -------------------------------
-- A payout records the method used and a reference (coupon code / transfer ref).
ALTER TABLE referral_partner_payments
  ADD COLUMN IF NOT EXISTS method    text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'coupon')),
  ADD COLUMN IF NOT EXISTS reference text;

-- Payouts are no longer one-per-month: drop the per-month uniqueness and the
-- NOT NULL on period_month (a balance payout isn't tied to a single month).
ALTER TABLE referral_partner_payments
  DROP CONSTRAINT IF EXISTS referral_partner_payments_period_unique;
ALTER TABLE referral_partner_payments
  ALTER COLUMN period_month DROP NOT NULL;

-- The one-time model paid each referral at most once; recurring commission pays
-- a member across many months, so this guard no longer applies.
DROP INDEX IF EXISTS referral_partner_payment_items_link_unique;

-- ---- 4. Concurrency-safe payout recorder --------------------
-- Balance payouts have variable amounts, so no unique constraint can guard
-- against two admins paying out at once. Serialise per partner with an advisory
-- lock and refuse a payout that would take total paid past total accrued (which
-- the app computes deterministically from membership dates and passes in).
CREATE OR REPLACE FUNCTION record_referral_payout(
  p_partner_id   uuid,
  p_accrued      numeric,   -- total accrued to date (server-computed)
  p_amount       numeric,   -- amount being paid now
  p_method       text,
  p_reference    text,
  p_note         text,
  p_paid_by      uuid,
  p_period_month date
) RETURNS referral_partner_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid    numeric;
  v_payment referral_partner_payments;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_partner_id::text, 42));

  SELECT COALESCE(sum(amount), 0) INTO v_paid
  FROM referral_partner_payments
  WHERE referral_partner_id = p_partner_id;

  -- Half a cent of slack absorbs rounding; anything more means a concurrent
  -- payout already settled this balance.
  IF v_paid + p_amount > p_accrued + 0.005 THEN
    RAISE EXCEPTION 'OVERPAY' USING errcode = 'P0001';
  END IF;

  INSERT INTO referral_partner_payments
    (referral_partner_id, period_month, calculated_amount, amount, conversion_count, note, paid_by, method, reference)
  VALUES
    (p_partner_id, p_period_month, p_accrued - v_paid, p_amount, 0, p_note, p_paid_by, p_method, p_reference)
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION record_referral_payout(uuid, numeric, numeric, text, text, text, uuid, date) FROM public;
REVOKE ALL ON FUNCTION record_referral_payout(uuid, numeric, numeric, text, text, text, uuid, date) FROM anon;
REVOKE ALL ON FUNCTION record_referral_payout(uuid, numeric, numeric, text, text, text, uuid, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION record_referral_payout(uuid, numeric, numeric, text, text, text, uuid, date) TO service_role;
