-- Add is_public column to threads
alter table threads add column if not exists is_public boolean default false;

-- Create index for public threads
create index if not exists threads_is_public_idx on threads(is_public) where is_public = true;

-- Allow anyone to view public threads
create policy "Anyone can view public threads"
  on threads for select
  using (is_public = true);

-- Allow anyone to view messages in public threads
create policy "Anyone can view messages in public threads"
  on messages for select
  using (exists (
    select 1 from threads where threads.id = messages.thread_id and threads.is_public = true
  ));
