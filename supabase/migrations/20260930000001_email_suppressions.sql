-- Addresses we must stop emailing, and why.
--
-- The email channel had no memory: a hard bounce, a spam complaint and an
-- unsubscribe all left the same trace, which is none, so the next broadcast
-- mailed the address again. Mailbox providers read exactly that pattern —
-- repeated sends to dead addresses, complaints that never turn into
-- unsubscribes — as the signature of a list that isn't maintained, and the
-- price is paid by every member whose mail starts landing in spam.
--
-- One row per address, not per member. A bounce is a fact about a mailbox:
-- the same address on a second member row is the same dead mailbox, and an
-- address that changes hands is a rarer problem than the one this solves.
--
-- Deliberately not a delete: 'why' and 'when' are the whole value. Lifting a
-- suppression is removing the row, which is an explicit admin act.

CREATE TABLE IF NOT EXISTS email_suppressions (
  -- Lowercased and trimmed by the application before it gets here.
  email       text PRIMARY KEY,
  -- bounced      — the mail server rejected it for good (hard bounce).
  -- complained   — the recipient pressed "this is spam".
  -- unsubscribed — the recipient asked us to stop, via the footer or the
  --                client's own one-click unsubscribe button.
  reason      text NOT NULL CHECK (reason IN ('bounced', 'complained', 'unsubscribed')),
  -- Whatever the provider said, or which link was used. Free text, for a human
  -- deciding whether a suppression should be lifted.
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_suppressions_reason_idx
  ON email_suppressions (reason, created_at DESC);

DROP TRIGGER IF EXISTS email_suppressions_updated_at ON email_suppressions;
CREATE TRIGGER email_suppressions_updated_at
  BEFORE UPDATE ON email_suppressions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;

-- Admins can see who we've stopped mailing. Everything that writes here is a
-- webhook or an unsubscribe link — neither carries a session — so those run
-- service-role and there is deliberately no INSERT/UPDATE/DELETE policy.
DROP POLICY IF EXISTS "Admins can view email suppressions" ON email_suppressions;
CREATE POLICY "Admins can view email suppressions"
  ON email_suppressions FOR SELECT
  USING (is_admin());
