-- A partner's commission percentage is negotiated for a fixed term. ends_at is
-- the last day the rate is honoured: a referral that becomes a paying member on
-- or before this date earns commission at `percentage`, one that converts after
-- it earns nothing. NULL means the rate runs indefinitely (the prior behaviour,
-- so existing partners are unaffected).
--
-- Only the *rate* expires — the partner, their referrals, and any commission
-- already accrued all survive, and admins can extend the term by moving the
-- date forward.
ALTER TABLE referral_partners
  ADD COLUMN IF NOT EXISTS ends_at date;

COMMENT ON COLUMN referral_partners.ends_at IS
  'Last day the commission percentage is honoured. NULL = no expiry.';

-- Conversion date snapshot. Whether a referral is "active" stays reconciled on
-- read from members.membership_status, but the *date* it converted has to be
-- durable — monthly payouts need to attribute each conversion to a month, and
-- the source (members.membership_start_date) can be edited or the member row
-- unlinked. Stamped by the analytics helper on read; see
-- src/lib/referral-partners.ts.
CREATE INDEX IF NOT EXISTS referral_partner_links_converted_at_idx
  ON referral_partner_links (converted_at);
