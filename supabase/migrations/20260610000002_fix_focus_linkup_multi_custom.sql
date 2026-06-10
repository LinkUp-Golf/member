-- Drop ALL unique constraints on focus_linkup_subscriptions regardless of name,
-- then drop ALL non-primary unique indexes, then recreate only the correct
-- partial indexes. This makes it safe to run on any database state.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'focus_linkup_subscriptions'
      AND c.contype = 'u'
  ) LOOP
    EXECUTE format('ALTER TABLE focus_linkup_subscriptions DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT i.relname AS idx_name
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    WHERE t.relname = 'focus_linkup_subscriptions'
      AND x.indisunique = true
      AND NOT x.indisprimary
  ) LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.idx_name);
  END LOOP;
END;
$$;

-- Standard categories: one row per (member, category)
CREATE UNIQUE INDEX focus_linkup_subs_standard_uniq
  ON focus_linkup_subscriptions (member_id, industry_focus)
  WHERE custom_label IS NULL;

-- Custom groups: one row per (member, label) — allows many 'Other' rows per member
CREATE UNIQUE INDEX focus_linkup_subs_custom_uniq
  ON focus_linkup_subscriptions (member_id, custom_label)
  WHERE custom_label IS NOT NULL;
