-- The announcements feed now only surfaces promotions, admin announcements,
-- and admin-posted new course/event notices. Drop the legacy system-noise
-- and focus-linkup cross-post types.
delete from announcements
where type in ('new_member', 'booking', 'visiting_member', 'focus_linkup');
