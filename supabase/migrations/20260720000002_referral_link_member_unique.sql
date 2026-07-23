-- A referred person can only be referred once.
--
-- referral_partner_links already enforces this on email, but a member is the
-- same person whichever address they're listed under. Without a constraint on
-- member_id, someone referred at their personal address could be referred
-- again at their work address — two link rows for one person, counted twice in
-- stats and paid twice in commission.
--
-- Application-side checks live in src/lib/referral-links.ts; this index is the
-- race-safe backstop for them.

-- Collapse any duplicates that already exist before the index can be created.
-- The earliest link wins: it's the attribution that was made first, and the
-- partner who got there first is the one who earned it. Deleting the later row
-- only removes the duplicate attribution — the member and their CRM contact
-- are untouched.
--
-- Rows referenced by a payment are deliberately excluded from deletion: a paid
-- conversion must stay auditable. If a duplicate has already been paid, this
-- migration will fail on the index below rather than quietly destroy the
-- payment trail — that case needs a human to decide.
WITH ranked AS (
  SELECT
    id,
    member_id,
    row_number() OVER (PARTITION BY member_id ORDER BY created_at, id) AS rn
  FROM referral_partner_links
  WHERE member_id IS NOT NULL
)
DELETE FROM referral_partner_links l
USING ranked r
WHERE l.id = r.id
  AND r.rn > 1
  AND NOT EXISTS (
    SELECT 1 FROM referral_partner_payment_items pi WHERE pi.link_id = l.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS referral_partner_links_member_unique
  ON referral_partner_links (member_id) WHERE member_id IS NOT NULL;

COMMENT ON INDEX referral_partner_links_member_unique IS
  'A member can be referred once. Complements UNIQUE(email) for people listed under a second address.';
