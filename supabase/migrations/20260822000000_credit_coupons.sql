-- Credit spent as a GoHighLevel coupon.
--
-- Credit was only ever redeemable as a request: the member asked for an amount,
-- the admins got a push, and someone put it against a round by hand. Nothing
-- connected the balance to the place a member actually pays — the GHL checkout
-- behind courses.payment_url.
--
-- A coupon closes that gap. Redeeming issues a fixed-amount GHL coupon worth
-- the credit spent, and the member enters the code at checkout: the discount is
-- the credit. Cash and credit become two ways to settle the same bill, so a
-- host who is also a member can pay for their round out of what they earned
-- hosting.
--
-- The coupon row is the receipt tying three things together — the wallet debit
-- (ledger_entry_id), the coupon living in GHL (ghl_coupon_id / code), and what
-- it was issued against (booking_id / hosted_event_id). That last link is what
-- lets an admin see which bookings were paid with credit rather than cash.
--
-- Money invariants:
--   * A coupon never exists without a debit. issue_credit_coupon writes both in
--     one transaction, so a failure leaves neither.
--   * Credit that never got spent comes back. Cancelling or expiring an unused
--     coupon writes a compensating 'adjusted' row (see settle_credit_coupon) —
--     the ledger is append-only, so a refund is a new row, not a deletion.
--   * At most one open coupon per booking row, and per (member, hosted event) —
--     enforced by partial unique indexes below, so a double-tap can't debit the
--     wallet twice for one bill.

CREATE TABLE IF NOT EXISTS credit_coupons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Whose credit paid for it. The wallet is member-scoped (see 20260804000000),
  -- so this is the same member_id the debit row carries.
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- The 'redeemed' ledger row that funded this coupon. RESTRICT rather than
  -- CASCADE: a coupon must always be able to name the debit behind it, and the
  -- ledger is never deleted from.
  ledger_entry_id uuid NOT NULL REFERENCES credit_ledger(id) ON DELETE RESTRICT,
  amount          numeric(10,2) NOT NULL CHECK (amount > 0),
  -- What the member types at checkout. Unique here as well as in GHL, so a
  -- generated collision fails loudly instead of pointing two wallets at one
  -- coupon.
  code            text NOT NULL UNIQUE,
  -- GHL's own id, needed to fetch usage or delete the coupon. Null only in the
  -- window between the debit and GHL accepting the coupon; a row still holding
  -- null after that is one whose GHL call failed and which was voided.
  ghl_coupon_id   text,
  --   issued   — live in GHL, not yet used
  --   redeemed — GHL reports it used; the credit is spent for good
  --   void     — cancelled before use (by the member or an admin); refunded
  --   expired  — reached its end date unused; refunded
  status          text NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('issued', 'redeemed', 'void', 'expired')),
  -- What the coupon was issued against. Both null for a plain wallet
  -- conversion, which is a code the member can use at any checkout.
  booking_id      uuid REFERENCES bookings(id) ON DELETE SET NULL,
  hosted_event_id uuid REFERENCES hosted_events(id) ON DELETE SET NULL,
  -- The venue whose price the amount was based on. Kept even when the booking
  -- or event row is later removed, so the admin view can still say where the
  -- credit went.
  course_id       uuid REFERENCES courses(id) ON DELETE SET NULL,
  -- Mirror of GHL's usageCount, refreshed by the sync. Coupons are issued with
  -- usageLimit 1, so this is 0 or 1 in practice.
  usage_count     integer NOT NULL DEFAULT 0,
  starts_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  -- When it stopped being open (redeemed / void / expired).
  settled_at      timestamptz,
  note            text,
  created_by      uuid REFERENCES members(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The member's own list, newest first.
CREATE INDEX IF NOT EXISTS credit_coupons_member_idx
  ON credit_coupons (member_id, created_at DESC);

-- The admin bookings view asks "which of these bookings were paid with credit",
-- which is a lookup by booking id across a page of rows.
CREATE INDEX IF NOT EXISTS credit_coupons_booking_idx
  ON credit_coupons (booking_id) WHERE booking_id IS NOT NULL;

-- The sync only cares about coupons still open.
CREATE INDEX IF NOT EXISTS credit_coupons_open_idx
  ON credit_coupons (status, expires_at) WHERE status = 'issued';

-- One open coupon per bill. A second tap on "use credits" must not debit the
-- wallet again — the route reads the existing coupon back instead.
CREATE UNIQUE INDEX IF NOT EXISTS credit_coupons_open_booking_unique
  ON credit_coupons (booking_id)
  WHERE status = 'issued' AND booking_id IS NOT NULL;

-- Per member rather than per event: several members can each hold a coupon for
-- the same hosted round, but nobody holds two.
CREATE UNIQUE INDEX IF NOT EXISTS credit_coupons_open_event_unique
  ON credit_coupons (member_id, hosted_event_id)
  WHERE status = 'issued' AND hosted_event_id IS NOT NULL;

ALTER TABLE credit_coupons ENABLE ROW LEVEL SECURITY;

-- The holder reads their own codes; admins read all of them (the bookings view
-- queries this table directly from the admin client). Every write goes through
-- the service-role functions below, so there is no INSERT/UPDATE policy.
DROP POLICY IF EXISTS "Admins and owners can view credit coupons" ON credit_coupons;
CREATE POLICY "Admins and owners can view credit coupons"
  ON credit_coupons FOR SELECT
  USING (is_admin() OR member_id = auth.uid());

-- ---- Issue -------------------------------------------------------------
-- Debits the wallet and records the coupon in one transaction. The GHL coupon
-- itself is created by the caller straight afterwards; if that call fails the
-- caller settles this row as 'void', which refunds. Ordering matters: debit
-- first means a failure can only ever strand credit (recoverable, and visible
-- in the admin coupon list), never hand out a spendable coupon nobody paid for.
--
-- The balance, membership and locking rules are redeem_member_credit's, kept
-- identical on purpose — this is the same act of spending credit, so it must not
-- become a way around them.
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
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
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

-- ---- Attach the GHL id -------------------------------------------------
-- Separate from issue because the GHL call happens between them. Only ever sets
-- an id on a coupon that is still open and doesn't have one.
CREATE OR REPLACE FUNCTION attach_credit_coupon_ghl_id(
  p_coupon_id     uuid,
  p_ghl_coupon_id text
) RETURNS credit_coupons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row credit_coupons;
BEGIN
  UPDATE credit_coupons
     SET ghl_coupon_id = p_ghl_coupon_id,
         updated_at    = now()
   WHERE id = p_coupon_id
     AND ghl_coupon_id IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM credit_coupons WHERE id = p_coupon_id;
  END IF;

  RETURN v_row;
END;
$$;

-- ---- Settle ------------------------------------------------------------
-- Closes an open coupon:
--   'redeemed' — GHL says it was used. The credit is spent; nothing to refund.
--   'void'     — cancelled before use, by the member or an admin.
--   'expired'  — reached its end date unused.
-- Void and expired refund the amount as an 'adjusted' row, because the member
-- paid for a discount they never received.
--
-- Idempotent: a coupon that is no longer 'issued' is returned untouched, so a
-- sync that sees the same GHL state twice can't refund twice.
CREATE OR REPLACE FUNCTION settle_credit_coupon(
  p_coupon_id   uuid,
  p_outcome     text,
  p_usage_count integer,
  p_reason      text,
  p_created_by  uuid
) RETURNS credit_coupons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row credit_coupons;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('redeemed', 'void', 'expired') THEN
    RAISE EXCEPTION 'INVALID_OUTCOME' USING errcode = 'P0001';
  END IF;

  SELECT * INTO v_row FROM credit_coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPON_NOT_FOUND' USING errcode = 'P0001';
  END IF;

  -- Already settled. Returned rather than raised: both the member's cancel and
  -- the background sync can reach the same coupon, and neither is an error.
  IF v_row.status <> 'issued' THEN
    RETURN v_row;
  END IF;

  IF p_outcome = 'redeemed' THEN
    UPDATE credit_coupons
       SET status      = 'redeemed',
           usage_count = greatest(coalesce(p_usage_count, 1), 1),
           settled_at  = now(),
           updated_at  = now()
     WHERE id = p_coupon_id
    RETURNING * INTO v_row;

    RETURN v_row;
  END IF;

  -- Unused: the credit goes back. Recorded as an 'adjusted' row because the
  -- original redemption stays in the history — a refund is a movement of its
  -- own, not an erasure of what happened.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_row.member_id::text, 0));

  INSERT INTO credit_ledger (member_id, kind, amount, note, created_by)
  VALUES (
    v_row.member_id, 'adjusted', v_row.amount,
    coalesce(p_reason, CASE WHEN p_outcome = 'expired'
                           THEN 'Credit code ' || v_row.code || ' expired unused'
                           ELSE 'Credit code ' || v_row.code || ' cancelled' END),
    p_created_by
  );

  UPDATE credit_coupons
     SET status     = p_outcome,
         settled_at = now(),
         updated_at = now(),
         note       = coalesce(p_reason, note)
   WHERE id = p_coupon_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---- Money is service-role only ---------------------------------------
REVOKE ALL ON FUNCTION issue_credit_coupon(uuid, numeric, text, timestamptz, uuid, uuid, uuid, text, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION issue_credit_coupon(uuid, numeric, text, timestamptz, uuid, uuid, uuid, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION attach_credit_coupon_ghl_id(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION attach_credit_coupon_ghl_id(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION settle_credit_coupon(uuid, text, integer, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_credit_coupon(uuid, text, integer, text, uuid) TO service_role;

COMMENT ON TABLE credit_coupons IS
  'Credit converted into a GHL coupon. One row per code: the wallet debit that '
  'funded it, the GHL coupon it became, and the booking or hosted event it was '
  'issued against. Unused codes are refunded on cancel/expiry.';
