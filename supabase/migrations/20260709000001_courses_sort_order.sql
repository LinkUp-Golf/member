-- Manual display ordering for courses, controlled by admins on the Courses
-- admin page and applied to the member "select an event/course" (Book) screen.
-- Nullable: courses without an explicit position sort last (NULLS LAST), then
-- by name, so newly added courses fall to the bottom until an admin reorders.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- Backfill existing courses with a deterministic order matching the current
-- alphabetical-by-name display, so the initial reorder UI reflects what
-- members already see.
WITH ranked AS (
  SELECT id, (row_number() OVER (ORDER BY name)) * 10 AS pos
  FROM courses
)
UPDATE courses c
  SET sort_order = ranked.pos
  FROM ranked
  WHERE c.id = ranked.id
    AND c.sort_order IS NULL;

-- Ordered listing is filtered to active/bookable courses; index the sort key.
CREATE INDEX IF NOT EXISTS courses_sort_order_idx ON courses (sort_order);
