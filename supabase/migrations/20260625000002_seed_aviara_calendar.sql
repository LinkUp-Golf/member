-- Seed Aviara's known GHL Class Booking calendar ID now that the
-- courses table has the ghl_calendar_id column.
UPDATE courses
SET ghl_calendar_id = 'Z3ayBRvxxHVY3WDMcAyL'
WHERE slug = 'aviara';
