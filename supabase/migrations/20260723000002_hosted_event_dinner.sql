-- Hosted events: replace the free-text description with a structured
-- "dinner included?" flag.
--
-- Hosts found the free-text description added little, and what members actually
-- want to know is whether dinner is part of the event. Swap the text field for
-- a boolean.
ALTER TABLE hosted_events
  ADD COLUMN IF NOT EXISTS dinner boolean NOT NULL DEFAULT false;

ALTER TABLE hosted_events
  DROP COLUMN IF EXISTS description;
