-- Add a custom event/booking URL to courses (optional, any valid URL).
ALTER TABLE courses ADD COLUMN IF NOT EXISTS booking_url TEXT;
