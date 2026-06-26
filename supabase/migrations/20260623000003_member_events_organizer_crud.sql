-- Organizers can update their own events (reverts to pending_review if published)
create policy "Organizers can update own events"
  on member_events for update
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid());

-- Organizers can delete their own events
create policy "Organizers can delete own events"
  on member_events for delete
  using (organizer_id = auth.uid());
