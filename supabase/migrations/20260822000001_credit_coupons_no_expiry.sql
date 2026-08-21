-- Credit codes don't expire.
--
-- A code was given a 30-day life (longer for a round further out), and an unused
-- one was refunded when it lapsed. The idea was that credit shouldn't sit in a
-- code forever — but the effect was a deadline on money the member already
-- owned, on a code they might be holding for a round that moves. Credit doesn't
-- go stale in the wallet, so it shouldn't go stale in a code either.
--
-- So new codes are created with no end date at all (GHL accepts a coupon with no
-- endDate and reports it 'active'), and expires_at becomes nullable: NULL means
-- "never".
--
-- What replaces expiry as the way back:
--   * Refund — the member's own button, or an admin's. Deletes the coupon at GHL
--     and returns the credit. This is now the only route from an unused code
--     back to a balance, which is why it exists on both surfaces.
--   * The daily sync still runs. Its job is narrower now: mark codes GHL says
--     were used, and void ones that never reached GHL at all (issued, no
--     ghl_coupon_id — credit that would otherwise sit debited against nothing).
--
-- Rows written before this keep their expires_at and keep their old behaviour:
-- they were issued on the promise that they'd lapse and refund, and
-- settle_credit_coupon honours a stored date. Only NULL means never.

ALTER TABLE credit_coupons ALTER COLUMN expires_at DROP NOT NULL;

COMMENT ON COLUMN credit_coupons.expires_at IS
  'When the code stops working. NULL means never, which is how codes are issued '
  'now; a date is a legacy row from when codes lapsed after 30 days.';

-- The sweep is ordered oldest-first now that most rows have no expiry to sort
-- by, so the supporting index follows.
DROP INDEX IF EXISTS credit_coupons_open_idx;
CREATE INDEX IF NOT EXISTS credit_coupons_open_idx
  ON credit_coupons (status, created_at) WHERE status = 'issued';

-- ---- Issue, without requiring an expiry --------------------------------
-- Only the expiry rule changes: NULL is accepted and means the code never
-- lapses, while a supplied date must still be in the future — a code that
-- arrives already dead is a bug, not a policy.
CREATE OR REPLACE FUNCTION issue_credit_coupon(
  p_member_id       uuid,
  p_amount          numeric,
  p_code            text,
  p_expires_at      timestamptz,
  p_booking_id      uuid,
  p_hosted_event_id uuid,
  p_course_id       uuid,
  p_note            text,
  p_created_by      uuid
) RETURNS credit_coupons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric(10,2);
  v_ledger  credit_ledger;
  v_row     credit_coupons;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING errcode = 'P0001';
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'INVALID_CODE' USING errcode = 'P0001';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'INVALID_EXPIRY' USING errcode = 'P0001';
  END IF;

  -- Spending needs an active membership, exactly as redeeming does
  -- (20260806000002). A non-member host keeps earning; the code is what waits.
  IF NOT EXISTS (
    SELECT 1 FROM members
    WHERE id = p_member_id AND membership_status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING errcode = 'P0001';
  END IF;

  -- Same wallet lock as redeem/adjust, so two concurrent issues can't both read
  -- the same balance and overspend it.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));

  SELECT coalesce(sum(amount), 0) INTO v_balance
  FROM credit_ledger
  WHERE member_id = p_member_id;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE:%', v_balance USING errcode = 'P0001';
  END IF;

  -- 'golf' is the only purpose still writable (20260806000003), and a coupon
  -- always buys golf.
  INSERT INTO credit_ledger (member_id, kind, amount, purpose, note, created_by)
  VALUES (p_member_id, 'redeemed', -p_amount, 'golf',
          coalesce(p_note, 'Credit code ' || p_code), p_created_by)
  RETURNING * INTO v_ledger;

  INSERT INTO credit_coupons (
    member_id, ledger_entry_id, amount, code, expires_at,
    booking_id, hosted_event_id, course_id, note, created_by
  )
  VALUES (
    p_member_id, v_ledger.id, p_amount, p_code, p_expires_at,
    p_booking_id, p_hosted_event_id, p_course_id, p_note, p_created_by
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION issue_credit_coupon(uuid, numeric, text, timestamptz, uuid, uuid, uuid, text, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION issue_credit_coupon(uuid, numeric, text, timestamptz, uuid, uuid, uuid, text, uuid)
  TO service_role;

COMMENT ON TABLE credit_coupons IS
  'Credit converted into a GHL coupon. One row per code: the wallet debit that '
  'funded it, the GHL coupon it became, and the booking or hosted event it was '
  'issued against. Codes do not expire; an unused one is refunded when someone '
  'cancels it, or when the sync finds it never reached GHL.';
