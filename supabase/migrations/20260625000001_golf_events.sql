-- ============================================================
-- LinkUp Golf — Courses: Dynamic Booking Settings
-- Adds GHL calendar wiring and booking configuration to the
-- existing courses table so the booking flow is fully dynamic
-- (no more hardcoded Aviara constants in application code).
-- Uses IF NOT EXISTS to be idempotent.
-- ============================================================

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS ghl_calendar_id            TEXT,
  ADD COLUMN IF NOT EXISTS ghl_calendar_user_id       TEXT,
  ADD COLUMN IF NOT EXISTS cost_per_player            DECIMAL(10,2) DEFAULT 160,
  ADD COLUMN IF NOT EXISTS booking_rules              TEXT,
  ADD COLUMN IF NOT EXISTS required_tags              TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS meeting_interval_mins      INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS meeting_duration_mins      INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS min_scheduling_notice_mins INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS date_range_days            INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pre_buffer_mins            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS post_buffer_mins           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seats_per_class            INTEGER,
  ADD COLUMN IF NOT EXISTS requested_by               UUID REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by                UUID REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason           TEXT;

-- approval_status needs a CHECK constraint — add separately to avoid IF NOT EXISTS conflict
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'courses' AND column_name = 'approval_status'
  ) THEN
    ALTER TABLE courses
      ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'active'
        CHECK (approval_status IN ('pending','active','rejected','archived'));
  END IF;
END $$;

-- Seed Aviara with its known defaults
UPDATE courses SET
  cost_per_player       = 160,
  meeting_duration_mins = 300,
  approval_status       = 'active'
WHERE slug = 'aviara';

CREATE INDEX IF NOT EXISTS courses_approval_status_idx ON courses(approval_status);
CREATE INDEX IF NOT EXISTS courses_requested_by_idx    ON courses(requested_by);
