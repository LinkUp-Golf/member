-- Becoming a host no longer waits on anyone, so the queue that held the wait
-- goes with it.
--
-- POST /api/host/application now does everything the admin approval used to:
-- creates the hosts row, grants the venues, and turns the proposed rounds into
-- hosted_events. Nothing reads host_applications or host_application_events any
-- more, and an empty table that nothing writes is a trap for the next person.
--
-- What is NOT removed: the gate on an individual round. A hosted_event is still
-- created 'pending_approval' and needs a GHL calendar before a member can book
-- it. That was always the gate that mattered.

-- ---- Honour the applications still in the queue --------------------------
--
-- Anyone pending was going to be approved; dropping the table would silently
-- lose their submission and they would have to notice and re-apply. Grant the
-- role on the same terms the new endpoint would have.

-- The host row. Named after the member rather than the nickname the old form
-- collected, which is the rule the new endpoint follows.
INSERT INTO hosts (member_id, name, created_by, source, status)
SELECT DISTINCT ON (a.member_id)
  a.member_id,
  NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), '') AS name,
  a.member_id,
  'application',
  'active'
FROM host_applications a
JOIN members m ON m.id = a.member_id
WHERE a.status = 'pending'
  AND NOT EXISTS (SELECT 1 FROM hosts h WHERE h.member_id = a.member_id)
  AND NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), '') IS NOT NULL
ORDER BY a.member_id, a.created_at DESC;

-- The venues they asked for, skipping any course that has since gone.
INSERT INTO host_venues (host_id, course_id)
SELECT DISTINCT h.id, c.id
FROM host_applications a
JOIN hosts h ON h.member_id = a.member_id
JOIN courses c ON c.id = ANY(a.requested_course_ids)
WHERE a.status = 'pending'
  AND c.active
  AND c.approval_status IN ('active', 'pending')
  AND NOT EXISTS (
    SELECT 1 FROM host_venues hv WHERE hv.host_id = h.id AND hv.course_id = c.id
  );

-- The rounds they proposed, at venues they were actually granted, still in the
-- future, and not already turned into an event. 'pending_approval' because a
-- round needs its calendar before anyone can book it.
INSERT INTO hosted_events (
  host_id, course_id, event_date, tee_time, total_spots, member_guest_rate, dinner, status
)
SELECT h.id, e.course_id, e.event_date, e.tee_time, e.total_spots, e.member_guest_rate,
       e.dinner, 'pending_approval'
FROM host_application_events e
JOIN host_applications a ON a.id = e.application_id
JOIN hosts h ON h.member_id = a.member_id
WHERE a.status = 'pending'
  AND e.hosted_event_id IS NULL
  AND e.event_date >= CURRENT_DATE
  AND EXISTS (
    SELECT 1 FROM host_venues hv WHERE hv.host_id = h.id AND hv.course_id = e.course_id
  );

-- ---- Drop the queue ------------------------------------------------------
-- Child first: host_application_events references host_applications.
DROP TABLE IF EXISTS host_application_events;
DROP TABLE IF EXISTS host_applications;
