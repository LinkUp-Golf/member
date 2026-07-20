-- Host credit ledger. An append-only record of every credit movement; a host's
-- balance is SUM(amount). Signed amounts keep the balance a single sum:
--   earned   (+) — awarded by an admin after approving an event's proof
--   redeemed (-) — the host spends available credit
--   adjusted (±) — a manual admin correction
-- Credits are NEVER awarded automatically — an 'earned' row is written only by
-- award_host_event_credit, called from the admin credit-approval route.
CREATE TABLE IF NOT EXISTS host_credit_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id     uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  -- The event that earned the credit, when applicable. SET NULL keeps the
  -- ledger entry if the event is later removed.
  event_id    uuid REFERENCES hosted_events(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('earned', 'redeemed', 'adjusted')),
  amount      numeric(10,2) NOT NULL
                CHECK (
                  (kind = 'earned'   AND amount >= 0) OR
                  (kind = 'redeemed' AND amount <= 0) OR
                  (kind = 'adjusted')
                ),
  note        text,
  created_by  uuid REFERENCES members(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_credit_ledger_host_idx
  ON host_credit_ledger (host_id, created_at DESC);

-- An event is credited at most once. Partial unique so redeemed/adjusted rows
-- (and events with no credit) are unconstrained; the backstop against a
-- double-award from a double-submit or two admins.
CREATE UNIQUE INDEX IF NOT EXISTS host_credit_ledger_earned_event_unique
  ON host_credit_ledger (event_id) WHERE kind = 'earned' AND event_id IS NOT NULL;

ALTER TABLE host_credit_ledger ENABLE ROW LEVEL SECURITY;

-- The owning host and admins can read the ledger. All writes go through the
-- service-role RPCs / admin route below, so there is no INSERT policy.
DROP POLICY IF EXISTS "Admins and owners can view host credit ledger" ON host_credit_ledger;
CREATE POLICY "Admins and owners can view host credit ledger"
  ON host_credit_ledger FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.id = host_credit_ledger.host_id AND h.member_id = auth.uid()
    )
  );

-- ---- Award credit for an event (admin approval) --------------------------
-- Inserts the 'earned' ledger row and flips the event to credits_awarded in one
-- transaction. The event must be awaiting approval; the credited amount is the
-- event's member guest rate. The per-event partial unique makes a double-award
-- roll the whole thing back. Money-writing, so SECURITY DEFINER + service_role
-- only (never PostgREST-callable), mirroring record_referral_payment.
CREATE OR REPLACE FUNCTION award_host_event_credit(
  p_event_id   uuid,
  p_created_by uuid
) RETURNS host_credit_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host_id uuid;
  v_status  text;
  v_rate    numeric(10,2);
  v_row     host_credit_ledger;
BEGIN
  SELECT host_id, status, member_guest_rate
    INTO v_host_id, v_status, v_rate
  FROM hosted_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING errcode = 'P0001';
  END IF;
  IF v_status <> 'pending_credit_approval' THEN
    RAISE EXCEPTION 'EVENT_NOT_PENDING_APPROVAL' USING errcode = 'P0001';
  END IF;

  INSERT INTO host_credit_ledger (host_id, event_id, kind, amount, note, created_by)
  VALUES (v_host_id, p_event_id, 'earned', v_rate, 'Event credit approved', p_created_by)
  RETURNING * INTO v_row;

  UPDATE hosted_events
  SET status = 'credits_awarded'
  WHERE id = p_event_id;

  RETURN v_row;
END;
$$;

-- ---- Redeem available credit (host) --------------------------------------
-- Advisory-lock on the host, then check the live balance covers the redemption
-- before inserting the (negative) redeemed row — so two concurrent redemptions
-- can't overspend the balance. Money-writing: SECURITY DEFINER + service_role.
CREATE OR REPLACE FUNCTION redeem_host_credit(
  p_host_id    uuid,
  p_amount     numeric,
  p_note       text,
  p_created_by uuid
) RETURNS host_credit_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric(10,2);
  v_row     host_credit_ledger;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING errcode = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_host_id::text, 0));

  SELECT coalesce(sum(amount), 0) INTO v_balance
  FROM host_credit_ledger
  WHERE host_id = p_host_id;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE:%', v_balance USING errcode = 'P0001';
  END IF;

  INSERT INTO host_credit_ledger (host_id, kind, amount, note, created_by)
  VALUES (p_host_id, 'redeemed', -p_amount, p_note, p_created_by)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Money must not be PostgREST-callable by ordinary users — only the service
-- role (server-side admin/host routes) may execute these.
REVOKE ALL ON FUNCTION award_host_event_credit(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION award_host_event_credit(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION award_host_event_credit(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION award_host_event_credit(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION redeem_host_credit(uuid, numeric, text, uuid) FROM public;
REVOKE ALL ON FUNCTION redeem_host_credit(uuid, numeric, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION redeem_host_credit(uuid, numeric, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION redeem_host_credit(uuid, numeric, text, uuid) TO service_role;
