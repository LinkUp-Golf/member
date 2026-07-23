-- QA follow-ups for the host module:
--   1. reserve_hosted_event_spot: reject events whose date has already passed
--      (don't depend on the daily completion cron), and lock it down to the
--      service role like the money RPCs (defense in depth — a member should
--      never call it directly with someone else's member id).
--   2. adjust_host_credit: a lock-safe manual adjustment RPC so an admin
--      deduction can't race a concurrent redeem/adjust and drive the balance
--      negative (the route-level read-then-insert guard was not serialised).

-- ---- Reserve: add past-date guard --------------------------------------
CREATE OR REPLACE FUNCTION reserve_hosted_event_spot(
  p_event_id  uuid,
  p_member_id uuid
) RETURNS hosted_event_registrations
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_date   date;
  v_spots  int;
  v_used   int;
  v_row    hosted_event_registrations;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));

  SELECT status, event_date, total_spots INTO v_status, v_date, v_spots
  FROM hosted_events
  WHERE id = p_event_id;

  -- Not open if missing, not upcoming, or the date has already passed (an
  -- upcoming row whose date passed but the cron hasn't completed it yet).
  IF NOT FOUND OR v_status <> 'upcoming' OR v_date < current_date THEN
    RAISE EXCEPTION 'EVENT_NOT_OPEN' USING errcode = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM hosted_event_registrations
    WHERE hosted_event_id = p_event_id
      AND member_id = p_member_id
      AND status = 'reserved'
  ) THEN
    RAISE EXCEPTION 'ALREADY_REGISTERED' USING errcode = 'P0001';
  END IF;

  SELECT count(*) INTO v_used
  FROM hosted_event_registrations
  WHERE hosted_event_id = p_event_id
    AND status = 'reserved';

  IF v_used >= v_spots THEN
    RAISE EXCEPTION 'EVENT_FULL:%', greatest(v_spots - v_used, 0)
      USING errcode = 'P0001';
  END IF;

  INSERT INTO hosted_event_registrations (hosted_event_id, member_id, status)
  VALUES (p_event_id, p_member_id, 'reserved')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Only the service role (the server-side register route via the admin client)
-- may call it — a member must not be able to reserve on another member's behalf
-- by passing a different p_member_id.
REVOKE ALL ON FUNCTION reserve_hosted_event_spot(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION reserve_hosted_event_spot(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION reserve_hosted_event_spot(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION reserve_hosted_event_spot(uuid, uuid) TO service_role;

-- ---- Lock-safe manual credit adjustment --------------------------------
CREATE OR REPLACE FUNCTION adjust_host_credit(
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
  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING errcode = 'P0001';
  END IF;

  -- Same lock the redeem RPC takes, so a deduction can't race a concurrent
  -- redeem/adjust and push the balance below zero.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_host_id::text, 0));

  SELECT coalesce(sum(amount), 0) INTO v_balance
  FROM host_credit_ledger
  WHERE host_id = p_host_id;

  IF v_balance + p_amount < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE:%', v_balance USING errcode = 'P0001';
  END IF;

  INSERT INTO host_credit_ledger (host_id, kind, amount, note, created_by)
  VALUES (p_host_id, 'adjusted', p_amount, p_note, p_created_by)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION adjust_host_credit(uuid, numeric, text, uuid) FROM public;
REVOKE ALL ON FUNCTION adjust_host_credit(uuid, numeric, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION adjust_host_credit(uuid, numeric, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION adjust_host_credit(uuid, numeric, text, uuid) TO service_role;
