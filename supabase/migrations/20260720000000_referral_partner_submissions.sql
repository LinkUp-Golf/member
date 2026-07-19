-- Referral partners submit the people they've referred as a list; an admin
-- reviews the batch and imports it, which creates the referral_partner_links
-- attributing those contacts to that partner.
--
-- Partners can't write links directly: attribution decides who gets paid, and
-- referral_partner_links carries a global UNIQUE(email) — one contact belongs
-- to exactly one partner. Letting partners self-serve would make claiming a
-- contact a race. The submission is the request; the import is the decision.

CREATE TABLE IF NOT EXISTS referral_partner_submissions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_partner_id  uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'imported', 'rejected')),
  -- Optional context from the partner ("met these at the Carlsbad event").
  note                 text,
  entry_count          integer NOT NULL DEFAULT 0,
  -- How many entries actually became links. Null until reviewed; can be less
  -- than entry_count when some were already attributed elsewhere.
  imported_count       integer,
  rejection_reason     text,
  reviewed_by          uuid REFERENCES members(id),
  reviewed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_partner_submissions_partner_idx
  ON referral_partner_submissions (referral_partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS referral_partner_submissions_status_idx
  ON referral_partner_submissions (status);

-- One open submission per partner: a partner adds to the pending list rather
-- than queueing several batches an admin then has to reconcile against each
-- other. Mirrors referral_partner_applications_pending_unique.
CREATE UNIQUE INDEX IF NOT EXISTS referral_partner_submissions_pending_unique
  ON referral_partner_submissions (referral_partner_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS referral_partner_submission_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES referral_partner_submissions(id) ON DELETE CASCADE,
  email          text NOT NULL,
  name           text,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'imported', 'skipped')),
  -- Why an entry didn't import — shown to both the admin and the partner, so
  -- "already attributed to another partner" is visible rather than a silent drop.
  skip_reason    text,
  link_id        uuid REFERENCES referral_partner_links(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The same address twice in one batch is a typo, not two referrals.
ALTER TABLE referral_partner_submission_entries
  DROP CONSTRAINT IF EXISTS referral_partner_submission_entries_email_unique;
ALTER TABLE referral_partner_submission_entries
  ADD CONSTRAINT referral_partner_submission_entries_email_unique
  UNIQUE (submission_id, email);

CREATE INDEX IF NOT EXISTS referral_partner_submission_entries_submission_idx
  ON referral_partner_submission_entries (submission_id);

ALTER TABLE referral_partner_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_partner_submission_entries ENABLE ROW LEVEL SECURITY;

-- Admins see everything; a partner sees their own submissions. All writes go
-- through service-role API routes, so there are no INSERT/UPDATE policies.
DROP POLICY IF EXISTS "Admins and owners can view referral submissions"
  ON referral_partner_submissions;
CREATE POLICY "Admins and owners can view referral submissions"
  ON referral_partner_submissions FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM referral_partners p
      WHERE p.id = referral_partner_submissions.referral_partner_id
        AND p.member_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins and owners can view referral submission entries"
  ON referral_partner_submission_entries;
CREATE POLICY "Admins and owners can view referral submission entries"
  ON referral_partner_submission_entries FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM referral_partner_submissions s
      JOIN referral_partners p ON p.id = s.referral_partner_id
      WHERE s.id = referral_partner_submission_entries.submission_id
        AND p.member_id = auth.uid()
    )
  );
