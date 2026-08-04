-- Referral commission is paid as credit, not cash.
--
-- 'credit' joins cash/coupon as a payout method and becomes the default. A
-- credit payout lands in the partner's member credit wallet (see
-- 20260804000000_credit_wallet.sql), where it's spendable on golf or toward
-- membership like any other credit — so the two earning routes into the app
-- (hosting, referring) settle into one balance.
--
-- Cash and coupon stay available: a partner with no LinkUp account has no
-- wallet to credit, and paying them still has to be possible.

-- ---- 1. 'credit' as a method --------------------------------------------
ALTER TABLE referral_partners
  DROP CONSTRAINT IF EXISTS referral_partners_payout_method_check;
ALTER TABLE referral_partners
  ADD CONSTRAINT referral_partners_payout_method_check
  CHECK (payout_method IN ('credit', 'cash', 'coupon'));
ALTER TABLE referral_partners
  ALTER COLUMN payout_method SET DEFAULT 'credit';

ALTER TABLE referral_partner_payments
  DROP CONSTRAINT IF EXISTS referral_partner_payments_method_check;
ALTER TABLE referral_partner_payments
  ADD CONSTRAINT referral_partner_payments_method_check
  CHECK (method IN ('credit', 'cash', 'coupon'));

-- The policy changed for existing partners too, not only new ones — otherwise
-- "payouts are now credits" would apply to nobody currently earning.
--
-- Except partners with no member row: they have no wallet, so switching them
-- would make their next payout fail outright instead of paying them. They stay
-- on cash until an account exists for them.
UPDATE referral_partners
   SET payout_method = 'credit'
 WHERE payout_method = 'cash'
   AND member_id IS NOT NULL;

-- ---- 2. Link a credit row back to the payout it came from ---------------
ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS referral_payment_id uuid
    REFERENCES referral_partner_payments(id) ON DELETE SET NULL;

-- One credit row per payout. The backstop against a double-submit crediting
-- the wallet twice, mirroring the per-event award guard.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_referral_payment_unique
  ON credit_ledger (referral_payment_id) WHERE referral_payment_id IS NOT NULL;

-- ---- 3. Record a payout, crediting the wallet when that's the method ----
-- Same signature and overpay guard as before; the credit insert happens in the
-- same transaction as the payment row, so a wallet can never be credited for a
-- payout that didn't record (or vice versa).
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
  v_paid      numeric;
  v_member_id uuid;
  v_payment   referral_partner_payments;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_partner_id::text, 42));

  -- Fail before writing anything: a credit payout to a partner with no LinkUp
  -- account has nowhere to land, and recording the payment anyway would say
  -- they'd been paid when they hadn't.
  IF p_method = 'credit' THEN
    SELECT member_id INTO v_member_id
    FROM referral_partners
    WHERE id = p_partner_id;

    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'NO_ACCOUNT' USING errcode = 'P0001';
    END IF;
  END IF;

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

  IF p_method = 'credit' THEN
    INSERT INTO credit_ledger
      (member_id, kind, amount, note, created_by, referral_payment_id)
    VALUES
      (v_member_id, 'earned', p_amount,
       COALESCE(p_note, 'Referral commission'), p_paid_by, v_payment.id);
  END IF;

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION record_referral_payout(uuid, numeric, numeric, text, text, text, uuid, date)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_referral_payout(uuid, numeric, numeric, text, text, text, uuid, date)
  TO service_role;
