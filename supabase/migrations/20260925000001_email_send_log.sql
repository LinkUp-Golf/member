-- email_send_log: one row per email actually handed to Resend, per member.
--
-- Two jobs, and the second is why it's a table rather than a cache:
--
--   1. It answers "why didn't this member get an email?" after the fact. A
--      suppressed send is invisible by design, so without a record the only
--      honest answer is a shrug.
--   2. It is the state the throttle reads (src/lib/email/policy.ts). An
--      in-memory counter would be per-instance, and serverless means a member
--      could take the same notification once per warm lambda. A shared table
--      is the only place the count is true.
--
-- notification_log already records what a member was *told*; this records what
-- we *mailed*, which is a smaller set and a different question.

CREATE TABLE IF NOT EXISTS email_send_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        uuid        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- The policy key, not the raw tag: 'msg' rather than 'msg-<conversation>',
  -- so a cooldown applies to the kind of notification and not each instance.
  notification_key text        NOT NULL,
  category         text        NOT NULL,
  sent_at          timestamptz NOT NULL DEFAULT now()
);

-- The daily cap: every email for one member inside the rolling window.
CREATE INDEX IF NOT EXISTS email_send_log_member_sent_idx
  ON email_send_log(member_id, sent_at DESC);

-- The per-kind cooldown: the most recent send of one kind to one member.
CREATE INDEX IF NOT EXISTS email_send_log_member_key_idx
  ON email_send_log(member_id, notification_key, sent_at DESC);

ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;

-- Deliberately no policies. Only the service role writes and reads this, from
-- the send path; RLS on with no policy means a member's own token sees
-- nothing, which is correct — it's operational data, not their notification
-- history. That history is notification_log, which they can read.
