-- Links a referral partner to the members / non-members they referred.
-- Attribution lives entirely here (not in GHL). member_id is set when the
-- contact is (or later becomes) an existing LinkUp member; it stays null for
-- non-members, who are tracked by email (ghl_contact_id records the CRM lead we
-- create for them, when available). "Converted" (paying) status is reconciled
-- on read from the member row's membership_status, not stored here.
CREATE TABLE IF NOT EXISTS referral_partner_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_partner_id  uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  member_id            uuid REFERENCES members(id) ON DELETE SET NULL,
  email                text NOT NULL,
  ghl_contact_id       text,
  status               text NOT NULL DEFAULT 'linked' CHECK (status IN ('linked', 'converted')),
  converted_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- A contact belongs to exactly one partner — the GHL custom field is single
-- valued, so the same email cannot be linked to two partners. Enforced on the
-- lowercased email; the API re-points an existing link rather than duplicating.
ALTER TABLE referral_partner_links
  DROP CONSTRAINT IF EXISTS referral_partner_links_email_unique;
ALTER TABLE referral_partner_links
  ADD CONSTRAINT referral_partner_links_email_unique UNIQUE (email);

CREATE INDEX IF NOT EXISTS referral_partner_links_partner_idx ON referral_partner_links (referral_partner_id);
CREATE INDEX IF NOT EXISTS referral_partner_links_member_idx ON referral_partner_links (member_id);
CREATE INDEX IF NOT EXISTS referral_partner_links_email_idx ON referral_partner_links (email);

ALTER TABLE referral_partner_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view referral partner links" ON referral_partner_links;
CREATE POLICY "Admins can view referral partner links"
  ON referral_partner_links FOR SELECT
  USING (is_admin());
