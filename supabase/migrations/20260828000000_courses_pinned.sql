-- Pinning a venue on the member Book screen.
--
-- A pinned course is docked above the month agenda and kept stuck there while
-- the agenda scrolls, so a venue we want members to see first stays on screen
-- instead of being one club among however many the month happens to open.
--
-- Distinct from sort_order: that decides where a course sits in a list, this
-- takes it out of the list. Nothing stops more than one being pinned — the
-- dock lists each of them — but it's meant for one at a time.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- The member screen asks "which of these are pinned" on every load, and the
-- answer is almost always none or one — a partial index is the whole table's
-- worth of pinned rows.
CREATE INDEX IF NOT EXISTS courses_pinned_idx ON courses (pinned) WHERE pinned;
