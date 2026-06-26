-- ============================================================
-- LinkUp Golf — Courses: Dynamic Booking Settings
-- Adds GHL calendar wiring and booking configuration to the
-- existing courses table so the booking flow is fully dynamic
-- (no more hardcoded Aviara constants in application code).
-- ============================================================

ALTER TABLE courses
  -- GHL calendar for this course's tee-time bookings
  ADD COLUMN ghl_calendar_id            TEXT,
  ADD COLUMN ghl_calendar_user_id       TEXT,

  -- Per-course pricing and rules
  ADD COLUMN cost_per_player            DECIMAL(10,2) DEFAULT 160,
  ADD COLUMN booking_rules              TEXT,

  -- Extra tags (beyond access_tag) a member must have to book
  -- Empty array = any member with the course's access_tag can book
  ADD COLUMN required_tags              TEXT[] DEFAULT '{}',

  -- GHL calendar booking settings
  ADD COLUMN meeting_interval_mins      INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN meeting_duration_mins      INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN min_scheduling_notice_mins INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN date_range_days            INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN pre_buffer_mins            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN post_buffer_mins           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN seats_per_class            INTEGER,

  -- Approval workflow: admin-created = 'active', member-requested = 'pending'
  ADD COLUMN approval_status            TEXT NOT NULL DEFAULT 'active'
                                        CHECK (approval_status IN ('pending','active','rejected','archived')),
  ADD COLUMN requested_by               UUID REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_by                UUID REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN rejection_reason           TEXT;

-- Seed Aviara with its known defaults
UPDATE courses SET
  cost_per_player       = 160,
  meeting_duration_mins = 300,
  approval_status       = 'active'
WHERE slug = 'aviara';

CREATE INDEX courses_approval_status_idx ON courses(approval_status);
CREATE INDEX courses_requested_by_idx    ON courses(requested_by);
