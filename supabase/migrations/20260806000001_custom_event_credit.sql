-- Let an admin award a custom amount when approving a host's event credit.
--
-- Until now the award was always the event's member_guest_rate, decided when
-- the host created the listing. That's the right default and stays the default,
-- but it can't be the only answer: a round that ran short, a host who covered
-- more than they listed, a rate typed wrong weeks earlier. The admin approving
-- the proof is the one who knows, so they get to say.
--
-- The amount is settled in the same transaction as the status flip, exactly as
-- before, so a custom award can't half-happen. Overriding is recorded in the
-- ledger note rather than left to be inferred from a number that doesn't match
-- the event.

-- A default on the new argument would make a two-argument call ambiguous
-- against the old function, so the old one goes first.
DROP FUNCTION IF EXISTS award_host_event_credit(uuid, uuid);

CREATE FUNCTION award_host_event_credit(
  p_event_id   uuid,
  p_created_by uuid,
  -- NULL means "the rate the event was listed at" — the unchanged default.
  p_amount     numeric DEFAULT NULL,
  p_note       text    DEFAULT NULL
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
  v_amount    numeric(10,2);
  v_note      text;
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

  v_amount := round(COALESCE(p_amount, v_rate), 2);

  -- An award is credit earned, so it has to be positive. Zero would be a
  -- rejection dressed up as an approval, and negative is what adjust_member_credit
  -- is for.
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING errcode = 'P0001';
  END IF;

  -- Say in the ledger that the listed rate wasn't what was paid. Without this
  -- the only trace of an override is an amount that quietly disagrees with the
  -- event it points at.
  v_note := COALESCE(
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    CASE
      WHEN v_amount <> v_rate
        THEN format('Event credit approved at %s (listed rate %s)',
                    to_char(v_amount, 'FM$999,999,990.00'),
                    to_char(v_rate,   'FM$999,999,990.00'))
      ELSE 'Event credit approved'
    END
  );

  INSERT INTO credit_ledger (member_id, host_id, event_id, kind, amount, note, created_by)
  VALUES (v_member_id, v_host_id, p_event_id, 'earned', v_amount, v_note, p_created_by)
  RETURNING * INTO v_row;

  UPDATE hosted_events
  SET status = 'credits_awarded'
  WHERE id = p_event_id;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION award_host_event_credit(uuid, uuid, numeric, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION award_host_event_credit(uuid, uuid, numeric, text)
  TO service_role;
