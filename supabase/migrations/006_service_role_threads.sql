-- Service role policy for threads (Modal function uses service role to update token counts)
create policy "Service role can manage threads"
  on threads for all
  using (auth.role() = 'service_role');
