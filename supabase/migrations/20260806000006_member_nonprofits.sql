-- Non-profits a member supports, plus the report that ranks them.
--
-- Stored as an array rather than one newline-delimited text column, even
-- though that's how it's entered. Three of the four things we do with this
-- need the individual entries: the popularity report groups by them, admin
-- search matches one of them, and the profile renders them as separate chips.
-- Splitting a text column on '\n' at every read is the same data modelled
-- worse.

ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS nonprofits text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN member_profiles.nonprofits IS
  'Non-profits this member supports, max 3. Entered one per line in-app; also synced from the GHL contact.nonprofits custom field (GHL wins where it has a value).';

-- Backstop only — the API trims, drops blanks, dedupes and caps before
-- writing. A CHECK can''t call unnest (set-returning functions aren''t allowed
-- in one), so the per-entry rules are expressed the ways that are:
--   - '' <> ALL(...) rejects an empty entry. Vacuously true for '{}'.
--   - the joined length caps total size without needing per-element access.
ALTER TABLE member_profiles
  DROP CONSTRAINT IF EXISTS member_profiles_nonprofits_check;
ALTER TABLE member_profiles
  ADD CONSTRAINT member_profiles_nonprofits_check CHECK (
    coalesce(array_length(nonprofits, 1), 0) <= 3
    AND '' <> ALL(nonprofits)
    AND coalesce(length(array_to_string(nonprofits, ',')), 0) <= 400
  );

-- Admin member search matches on a single entry, which is a containment test
-- against the array rather than a scan of a text column.
CREATE INDEX IF NOT EXISTS member_profiles_nonprofits_idx
  ON member_profiles USING gin (nonprofits);

-- ---- Popularity report --------------------------------------
-- "Which non-profits are most popular by city or community."
--
-- Community is the member's home course; city is that course's city. Both are
-- reached the same way, so p_group_by picks the label rather than there being
-- two functions.
--
-- Two things worth knowing about the counting:
--
--   Grouping is case- and whitespace-insensitive. These are free-text entries
--   typed by members, so 'Boys & Girls Club' and 'boys & girls club' are one
--   non-profit, not two — a report that split them would rank everything
--   wrong. mode() picks the spelling the most members actually used for the
--   display label, so the report reads in members' own words.
--
--   Members with no home course (a host or referral partner who isn't a golf
--   member) are labelled rather than dropped. A report that silently omits
--   rows reads as complete when it isn't.
--
-- count(DISTINCT member_id) rather than count(*): a member can only list a
-- non-profit once after deduping, but this stays correct if that ever changes.

DROP FUNCTION IF EXISTS nonprofit_popularity(text);

CREATE FUNCTION nonprofit_popularity(p_group_by text DEFAULT 'city')
RETURNS TABLE (group_label text, nonprofit text, member_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    entries.label,
    mode() WITHIN GROUP (ORDER BY entries.raw) AS nonprofit,
    count(DISTINCT entries.member_id) AS member_count
  FROM (
    SELECT
      CASE
        WHEN p_group_by = 'community' THEN coalesce(c.name, 'No community')
        ELSE coalesce(nullif(btrim(c.city), ''), 'No city')
      END AS label,
      m.id AS member_id,
      btrim(np.value) AS raw
    FROM members m
    JOIN member_profiles p ON p.id = m.id
    LEFT JOIN courses c ON c.id = m.home_course_id
    CROSS JOIN LATERAL unnest(p.nonprofits) AS np(value)
    WHERE btrim(np.value) <> ''
  ) entries
  GROUP BY entries.label, lower(entries.raw)
  ORDER BY entries.label, count(DISTINCT entries.member_id) DESC, 2;
$$;

-- SECURITY DEFINER, so it reads every member's profile regardless of the
-- caller's RLS. That's the point — it's an admin report — but it means the
-- function must not be reachable by a member. Called from the admin API route
-- with the service-role client, behind withAuth({ requireAdmin: true }).
REVOKE ALL ON FUNCTION nonprofit_popularity(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION nonprofit_popularity(text) TO service_role;
