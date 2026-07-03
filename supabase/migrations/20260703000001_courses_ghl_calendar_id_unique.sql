-- Prevent two courses from being concurrently assigned the same GHL
-- calendar. Previously only enforced by a check-then-insert/update query in
-- application code, which is racy under concurrent admin requests — two
-- courses could end up sharing a calendar, causing bookings to be created
-- against the wrong course's calendar. NULLs remain unrestricted (a course
-- may not have a calendar configured yet), matching how the existing `slug`
-- unique constraint already behaves.
ALTER TABLE courses
  ADD CONSTRAINT courses_ghl_calendar_id_unique UNIQUE (ghl_calendar_id);
