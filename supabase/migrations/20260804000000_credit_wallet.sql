-- One credit wallet per member, spendable on golf or membership.
--
-- The ledger was host-scoped because hosting was the only way to earn credit.
-- That no longer holds: referral commission is about to be paid as credit too,
-- and a referral partner needn't be a host. Keying a balance on host_id would
-- mean either inventing a host row for every partner or running two wallets
-- with two balances — neither of which is what "credits usable for golf or
-- membership" describes.
--
-- So the ledger becomes member-scoped:
--   member_id — who the credit belongs to. What a balance is SUM()'d over.
--   host_id   — retained, and still set on host-earned rows, so an event's
--               award is attributable and the per-event award guard still bites.
--               Now nullable: credit can arrive without a host row.
--   purpose   — what a redemption was spent on ('golf' | 'membership'). Only
--               meaningful on redeemed rows.
--
-- Redemption policy: credit is spendable on golf OR membership, whether the
-- holder is a golf member or a non-member host. That's why purpose is required
-- on new redemptions — the choice is recorded rather than left in a free-text
-- note an admin has to interpret when settling it.

-- ---- 1. Rename: it is no longer only a host ledger -----------------------
-- Guarded so a re-run is a no-op rather than an error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'host_credit_ledger')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'credit_ledger')
  THEN
    ALTER TABLE host_credit_ledger RENAME TO credit_ledger;
  END IF;
END $$;

ALTER INDEX IF EXISTS host_credit_ledger_host_idx           RENAME TO credit_ledger_host_idx;
ALTER INDEX IF EXISTS host_credit_ledger_earned_event_unique RENAME TO credit_ledger_earned_event_unique;

-- ---- 2. Member ownership -------------------------------------------------
ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(id) ON DELETE CASCADE;

-- Every existing row was earned/spent by a host, and hosts.member_id is NOT
-- NULL, so this backfill is total. Anything left null would fail the SET NOT
-- NULL below, which is the outcome we want — silently dropping a credit row's
-- owner would lose money.
UPDATE credit_ledger l
   SET member_id = h.member_id
  FROM hosts h
 WHERE h.id = l.host_id
   AND l.member_id IS NULL;

ALTER TABLE credit_ledger ALTER COLUMN member_id SET NOT NULL;
ALTER TABLE credit_ledger ALTER COLUMN host_id   DROP NOT NULL;

-- Balances and history are read per member.
CREATE INDEX IF NOT EXISTS credit_ledger_member_idx
  ON credit_ledger (member_id, created_at DESC);

-- ---- 3. What a redemption was spent on -----------------------------------
-- Nullable, and not back-enforced with a CHECK: redemptions recorded before
-- this migration predate the choice, and inventing a purpose for them would
-- put made-up data in a money ledger. New redemptions are required to carry
-- one by redeem_member_credit below.
ALTER TABLE credit_ledger
  ADD COLUMN IF NOT EXISTS purpose text
    CHECK (purpose IS NULL OR purpose IN ('golf', 'membership'));

COMMENT ON TABLE credit_ledger IS
  'Append-only member credit wallet. Balance = SUM(amount) per member_id. '
  'Signed amounts: earned (+), redeemed (-), adjusted (±).';

-- ---- 4. RLS: the owning member reads their own wallet --------------------
-- Widened from "the member who owns the host row" to "the member the credit
-- belongs to", so a partner with credit but no host row can read it.
DROP POLICY IF EXISTS "Admins and owners can view host credit ledger" ON credit_ledger;
DROP POLICY IF EXISTS "Admins and owners can view credit ledger" ON credit_ledger;
CREATE POLICY "Admins and owners can view credit ledger"
  ON credit_ledger FOR SELECT
  USING (is_admin() OR member_id = auth.uid());

-- ---- 5. Award event credit (admin approval) ------------------------------
-- Unchanged in behaviour; now resolves the host's member so the credit lands in
-- that member's wallet. Dropped rather than replaced because the return type
-- was renamed along with the table.
DROP FUNCTION IF EXISTS award_host_event_credit(uuid, uuid);
CREATE FUNCTION award_host_event_credit(
  p_event_id   uuid,
  p_created_by uuid
) RETURNS credit_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host_id   uuid;
  v_member_id uuid;
  v_status    text;
  v_rate      numeric(10,2);
  v_row       credit_ledger;
BEGIN
  SELECT e.host_id, h.member_id, e.status, e.member_guest_rate
    INTO v_host_id, v_member_id, v_status, v_rate
  FROM hosted_events e
  JOIN hosts h ON h.id = e.host_id
  WHERE e.id = p_event_id
  FOR UPDATE OF e;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING errcode = 'P0001';
  END IF;
  IF v_status <> 'pending_credit_approval' THEN
    RAISE EXCEPTION 'EVENT_NOT_PENDING_APPROVAL' USING errcode = 'P0001';
  END IF;

  INSERT INTO credit_ledger (member_id, host_id, event_id, kind, amount, note, created_by)
  VALUES (v_member_id, v_host_id, p_event_id, 'earned', v_rate, 'Event credit approved', p_created_by)
  RETURNING * INTO v_row;

  UPDATE hosted_events
  SET status = 'credits_awarded'
  WHERE id = p_event_id;

  RETURN v_row;
END;
$$;

-- ---- 6. Redeem credit toward golf or membership --------------------------
-- Replaces redeem_host_credit: keyed on the member, and the purpose is
-- required, so an admin settling the redemption knows what it buys.
DROP FUNCTION IF EXISTS redeem_host_credit(uuid, numeric, text, uuid);
CREATE FUNCTION redeem_member_credit(
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

-- ---- 7. Manual admin adjustment -----------------------------------------
-- Replaces adjust_host_credit. Takes the same wallet lock as redeem, so an
-- admin deduction can't race a redemption below zero.
DROP FUNCTION IF EXISTS adjust_host_credit(uuid, numeric, text, uuid);
CREATE FUNCTION adjust_member_credit(
  p_member_id  uuid,
  p_amount     numeric,
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
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING errcode = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));

  SELECT coalesce(sum(amount), 0) INTO v_balance
  FROM credit_ledger
  WHERE member_id = p_member_id;

  IF v_balance + p_amount < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE:%', v_balance USING errcode = 'P0001';
  END IF;

  INSERT INTO credit_ledger (member_id, kind, amount, note, created_by)
  VALUES (p_member_id, 'adjusted', p_amount, p_note, p_created_by)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---- 8. Money is service-role only --------------------------------------
REVOKE ALL ON FUNCTION award_host_event_credit(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION award_host_event_credit(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION redeem_member_credit(uuid, numeric, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_member_credit(uuid, numeric, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION adjust_member_credit(uuid, numeric, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION adjust_member_credit(uuid, numeric, text, uuid) TO service_role;
