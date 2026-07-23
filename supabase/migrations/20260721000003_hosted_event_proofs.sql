-- Proof that a hosted event actually occurred — an uploaded photo an admin
-- reviews before awarding the host's credits. A separate table (rather than a
-- column on hosted_events) so the "one image now, a gallery later" expansion
-- needs no migration or refactor: additional rows are simply more proofs.
CREATE TABLE IF NOT EXISTS hosted_event_proofs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hosted_event_id  uuid NOT NULL REFERENCES hosted_events(id) ON DELETE CASCADE,
  -- Public URL in the post-media storage bucket (reused; see the proof route).
  image_url        text NOT NULL,
  uploaded_by      uuid REFERENCES members(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hosted_event_proofs_event_idx
  ON hosted_event_proofs (hosted_event_id, created_at DESC);

ALTER TABLE hosted_event_proofs ENABLE ROW LEVEL SECURITY;

-- The owning host and admins can view proofs. Writes go through service-role
-- routes (the proof-upload route), so there is no INSERT policy.
DROP POLICY IF EXISTS "Admins and owning host can view event proofs" ON hosted_event_proofs;
CREATE POLICY "Admins and owning host can view event proofs"
  ON hosted_event_proofs FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM hosted_events e
      JOIN hosts h ON h.id = e.host_id
      WHERE e.id = hosted_event_proofs.hosted_event_id
        AND h.member_id = auth.uid()
    )
  );
