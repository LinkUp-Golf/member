-- Credit is redeemed toward golf. 'membership' is no longer offered.
--
-- The two purposes made sense while a non-member could redeem: putting credit
-- toward joining was the whole point of the membership option. Requiring an
-- active membership to redeem (20260806000002) removed the person that option
-- was for — everyone who can now redeem is already a member, so "put it toward
-- membership" asks them to buy something they have.
--
-- The purpose column and its CHECK are left alone: redemptions already recorded
-- against 'membership' are real history and must stay readable. What changes is
-- what may be written from here on.

CREATE OR REPLACE FUNCTION redeem_member_credit(
  p_member_id  uuid,
  p_amount     numeric,
  p_purpose    text,
  p_note       text,
  p_created_by uuid
) RETURNS credit_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric(10,2);
  v_row     credit_ledger;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING errcode = 'P0001';
  END IF;

  -- 'golf' is the only purpose that can still be written. Kept as a parameter
  -- rather than hardcoded because the column keeps recording it, and a future
  -- purpose (pro shop, dinner) would land here rather than needing a new shape.
  IF p_purpose IS NULL OR p_purpose <> 'golf' THEN
    RAISE EXCEPTION 'INVALID_PURPOSE' USING errcode = 'P0001';
  END IF;

  -- Unchanged from 20260806000002: spending requires an active membership.
  IF NOT EXISTS (
    SELECT 1 FROM members
    WHERE id = p_member_id AND membership_status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER' USING errcode = 'P0001';
  END IF;

  -- Serialise this member's wallet so two concurrent redemptions can't both
  -- read the same balance and overspend it.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));

  SELECT coalesce(sum(amount), 0) INTO v_balance
  FROM credit_ledger
  WHERE member_id = p_member_id;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE:%', v_balance USING errcode = 'P0001';
  END IF;

  INSERT INTO credit_ledger (member_id, kind, amount, purpose, note, created_by)
  VALUES (p_member_id, 'redeemed', -p_amount, p_purpose, p_note, p_created_by)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION redeem_member_credit(uuid, numeric, text, text, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_member_credit(uuid, numeric, text, text, uuid)
  TO service_role;
