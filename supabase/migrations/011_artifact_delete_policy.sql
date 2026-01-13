-- Allow users to delete artifacts in their threads
create policy "Users can delete artifacts in their threads"
  on artifacts for delete
  using (thread_id in (select id from threads where user_id = auth.uid()));

-- Also allow anonymous users to delete artifacts in anonymous threads
create policy "Anyone can delete artifacts in anonymous threads"
  on artifacts for delete
  using (thread_id in (select id from threads where user_id is null));
