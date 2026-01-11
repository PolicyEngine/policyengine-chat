-- Add user_id to threads table
alter table threads add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Create index for user_id queries
create index if not exists threads_user_id_idx on threads(user_id);

-- Drop existing policies
drop policy if exists "Allow all access to threads" on threads;
drop policy if exists "Allow all access to messages" on messages;
drop policy if exists "Allow all access to agent_logs" on agent_logs;

-- Create user-scoped policies for threads
create policy "Users can view their own threads"
  on threads for select
  using (auth.uid() = user_id);

create policy "Users can create their own threads"
  on threads for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own threads"
  on threads for update
  using (auth.uid() = user_id);

create policy "Users can delete their own threads"
  on threads for delete
  using (auth.uid() = user_id);

-- Create user-scoped policies for messages (via thread ownership)
create policy "Users can view messages in their threads"
  on messages for select
  using (exists (
    select 1 from threads where threads.id = messages.thread_id and threads.user_id = auth.uid()
  ));

create policy "Users can create messages in their threads"
  on messages for insert
  with check (exists (
    select 1 from threads where threads.id = messages.thread_id and threads.user_id = auth.uid()
  ));

-- Create user-scoped policies for agent_logs (via thread ownership)
create policy "Users can view logs in their threads"
  on agent_logs for select
  using (exists (
    select 1 from threads where threads.id = agent_logs.thread_id and threads.user_id = auth.uid()
  ));

create policy "Users can create logs in their threads"
  on agent_logs for insert
  with check (exists (
    select 1 from threads where threads.id = agent_logs.thread_id and threads.user_id = auth.uid()
  ));

create policy "Users can delete logs in their threads"
  on agent_logs for delete
  using (exists (
    select 1 from threads where threads.id = agent_logs.thread_id and threads.user_id = auth.uid()
  ));

-- Service role policy for agent_logs (Modal function uses service role)
create policy "Service role can manage agent_logs"
  on agent_logs for all
  using (auth.role() = 'service_role');

create policy "Service role can manage messages"
  on messages for all
  using (auth.role() = 'service_role');
