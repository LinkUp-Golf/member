-- Redeeming credit requires an active LinkUp membership.
--
-- Hosts and referral partners can use the app without a golf membership — they
-- get in on a role tag and land as 'non_member' (see 20260723000004). They earn
-- credit that way too, and that doesn't change: hosting a round or referring a
-- member is worth what it's worth whether or not you're a member yourself.
--
-- Spending it is the part that now requires membership. Credit buys golf or
-- goes toward membership, and a non-member has no course access to spend it on;
-- what they have is a balance waiting for them to join. So the balance keeps
-- accruing and the redemption is what's gated.
--
-- The check lives in the function rather than the route because the wallet is
-- one member wallet reached from two workspaces (/host and /partner). A gate on
-- one route would be walked around by anyone holding both roles.
--
-- Earning is untouched: award_host_event_credit and record_referral_payout both
-- still credit a non-member, and adjust_member_credit still lets an admin
-- correct any balance.

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
  IF p_purpose IS NULL OR p_purpose NOT IN ('golf', 'membership') THEN
    RAISE EXCEPTION 'INVALID_PURPOSE' USING errcode = 'P0001';
  END IF;

  -- 'active' is the app's own record of "holds a course access tag", kept
  -- current by the GHL sync. Every other status is someone who can't
  -- spend: non_member (role tag only), waitlist and pending (not yet),
  -- suspended and cancelled (not any more).
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

-- CREATE OR REPLACE keeps existing grants, but restate them so this file is
-- self-contained if it's ever read on its own.
REVOKE ALL ON FUNCTION redeem_member_credit(uuid, numeric, text, text, uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_member_credit(uuid, numeric, text, text, uuid)
  TO service_role;
