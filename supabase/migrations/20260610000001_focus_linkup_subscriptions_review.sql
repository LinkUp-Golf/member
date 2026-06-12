-- Add review workflow fields to focus_linkup_subscriptions
ALTER TABLE focus_linkup_subscriptions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- Custom (Other) groups requested before this migration should be pending
UPDATE focus_linkup_subscriptions
SET status = 'pending'
WHERE industry_focus = 'Other' AND custom_label IS NOT NULL;

-- Drop the old simple unique constraint if it exists so we can allow
-- multiple 'Other' rows per member (one per custom group)
ALTER TABLE focus_linkup_subscriptions
  DROP CONSTRAINT IF EXISTS focus_linkup_subscriptions_member_id_industry_focus_key;

DROP INDEX IF EXISTS focus_linkup_subscriptions_member_id_industry_focus_key;

-- Standard categories remain unique per member
CREATE UNIQUE INDEX IF NOT EXISTS focus_linkup_subs_standard_uniq
  ON focus_linkup_subscriptions (member_id, industry_focus)
  WHERE custom_label IS NULL;

-- Custom groups are unique per member + custom_label
CREATE UNIQUE INDEX IF NOT EXISTS focus_linkup_subs_custom_uniq
  ON focus_linkup_subscriptions (member_id, custom_label)
  WHERE custom_label IS NOT NULL;
