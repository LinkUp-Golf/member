-- Add announcement types for promotions and new-course notices.
-- Must land in its own migration: a new enum label can't be used in the
-- same transaction that adds it.
alter type announcement_type add value if not exists 'new_course';
alter type announcement_type add value if not exists 'promotion';
