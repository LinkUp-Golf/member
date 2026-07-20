-- Hosted events: a host offers a golf event at a course on a date with a fixed
-- number of member spots at a member guest rate. Members reserve spots; a
-- reservation is one hosted_event_registrations row (mirroring how a booking
-- seat is one bookings row). Capacity is the event's own total_spots — this is
-- deliberately decoupled from the course's GHL calendar, daily cap, and
-- appointment creation, which don't apply to a host-run event.
--
-- The displayed member price is member_guest_rate + a fixed markup (see
-- HOST_MEMBER_PRICE_MARKUP_USD in src/lib/constants.ts); only the guest rate is
-- stored, and the earned credit is based on it.
CREATE TABLE IF NOT EXISTS hosted_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id             uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  course_id           uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  event_date          date NOT NULL,
  -- Optional — some events have no fixed tee time.
  tee_time            time,
  total_spots         integer NOT NULL CHECK (total_spots >= 1),
  member_guest_rate   numeric(10,2) NOT NULL CHECK (member_guest_rate >= 0),
  description         text,
  -- Lifecycle: draft (not yet published) -> upcoming (live, joinable) ->
  -- completed (event date passed) -> pending_credit_approval (proof uploaded)
  -- -> credits_awarded. cancelled is terminal and can be set before completion.
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN (
                          'draft', 'upcoming', 'completed',
                          'cancelled', 'pending_credit_approval', 'credits_awarded'
                        )),
  cancellation_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hosted_events_host_idx   ON hosted_events (host_id, event_date DESC);
CREATE INDEX IF NOT EXISTS hosted_events_status_idx ON hosted_events (status);
CREATE INDEX IF NOT EXISTS hosted_events_date_idx   ON hosted_events (event_date);
CREATE INDEX IF NOT EXISTS hosted_events_course_idx ON hosted_events (course_id);

DROP TRIGGER IF EXISTS hosted_events_updated_at ON hosted_events;
CREATE TRIGGER hosted_events_updated_at
  BEFORE UPDATE ON hosted_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- Registrations (one seat = one row) ----------------------------------
CREATE TABLE IF NOT EXISTS hosted_event_registrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hosted_event_id  uuid NOT NULL REFERENCES hosted_events(id) ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'reserved'
                     CHECK (status IN ('reserved', 'cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- A member holds at most one active spot per event. Partial (only 'reserved')
-- so a member who cancels can register again — the cancelled row remains as
-- history. Race-safe backstop to the reserve function's count.
CREATE UNIQUE INDEX IF NOT EXISTS hosted_event_registrations_active_unique
  ON hosted_event_registrations (hosted_event_id, member_id) WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS hosted_event_registrations_event_idx
  ON hosted_event_registrations (hosted_event_id);
CREATE INDEX IF NOT EXISTS hosted_event_registrations_member_idx
  ON hosted_event_registrations (member_id);

-- ---- Atomic spot reservation ---------------------------------------------
-- Advisory-lock + count + insert in one transaction, mirroring
-- create_bookings_for_day. Serialises reservations for THIS event only, so the
-- remaining-spots count is consistent with the insert and two members can't
-- race for the last seat. Raises P0001 errors the route parses:
--   EVENT_NOT_OPEN         — event missing or not in 'upcoming'
--   ALREADY_REGISTERED     — caller already holds an active spot
--   EVENT_FULL:<remaining> — no seats left
CREATE OR REPLACE FUNCTION reserve_hosted_event_spot(
  p_event_id  uuid,
  p_member_id uuid
) RETURNS hosted_event_registrations
LANGUAGE plpgsql
AS $$
DECLARE
  v_status  text;
  v_spots   int;
  v_used    int;
  v_row     hosted_event_registrations;
BEGIN
  -- Serialise concurrent reservations for THIS event only. Transaction-scoped:
  -- releases on commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));

  SELECT status, total_spots INTO v_status, v_spots
  FROM hosted_events
  WHERE id = p_event_id;

  IF NOT FOUND OR v_status <> 'upcoming' THEN
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

-- ---- RLS -----------------------------------------------------------------
ALTER TABLE hosted_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_event_registrations ENABLE ROW LEVEL SECURITY;

-- Events: any member can browse a published (non-draft) event; the owning host
-- and admins see all, including drafts. Writes go through service-role routes.
DROP POLICY IF EXISTS "View hosted events" ON hosted_events;
CREATE POLICY "View hosted events"
  ON hosted_events FOR SELECT
  USING (
    is_admin()
    OR status <> 'draft'
    OR EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.id = hosted_events.host_id AND h.member_id = auth.uid()
    )
  );

-- Registrations: a member sees their own; the owning host sees their events'
-- registrations; admins see all.
DROP POLICY IF EXISTS "View hosted event registrations" ON hosted_event_registrations;
CREATE POLICY "View hosted event registrations"
  ON hosted_event_registrations FOR SELECT
  USING (
    is_admin()
    OR member_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM hosted_events e
      JOIN hosts h ON h.id = e.host_id
      WHERE e.id = hosted_event_registrations.hosted_event_id
        AND h.member_id = auth.uid()
    )
  );
