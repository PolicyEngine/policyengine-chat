-- Artifacts table for storing HTML/JS visualizations
create table if not exists artifacts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references messages(id) on delete cascade,
  thread_id uuid references threads(id) on delete cascade,
  type text not null default 'html',
  title text,
  content text not null,
  dependencies jsonb default '[]'::jsonb,
  created_at timestamp with time zone default now()
);

-- RLS policies
alter table artifacts enable row level security;

create policy "Users can view artifacts in their threads"
  on artifacts for select
  using (thread_id in (select id from threads where user_id = auth.uid()));

create policy "Service role can insert artifacts"
  on artifacts for insert
  with check (true);

-- Enable realtime
alter publication supabase_realtime add table artifacts;
