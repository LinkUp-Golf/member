-- Store the GHL Calendar Group ID per course.
-- Created automatically when admin adds a new course.
ALTER TABLE courses ADD COLUMN IF NOT EXISTS ghl_group_id TEXT;
