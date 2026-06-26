-- Support multi-day events
alter table member_events
  add column if not exists event_end_date date;
