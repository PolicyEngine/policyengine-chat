-- Chat threads table
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Messages table
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

-- Agent logs table for streaming logs during agent execution
create table if not exists agent_logs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists messages_thread_id_idx on messages(thread_id);
create index if not exists messages_created_at_idx on messages(thread_id, created_at);
create index if not exists agent_logs_thread_id_idx on agent_logs(thread_id);
create index if not exists agent_logs_created_at_idx on agent_logs(thread_id, created_at);

-- Update updated_at on threads when messages are added
create or replace function update_thread_timestamp()
returns trigger as $$
begin
  update threads set updated_at = now() where id = new.thread_id;
  return new;
end;
$$ language plpgsql;

create trigger update_thread_on_message
  after insert on messages
  for each row
  execute function update_thread_timestamp();

-- RLS policies
alter table threads enable row level security;
alter table messages enable row level security;
alter table agent_logs enable row level security;

-- Allow all access for now (add auth policies later)
create policy "Allow all access to threads" on threads for all using (true);
create policy "Allow all access to messages" on messages for all using (true);
create policy "Allow all access to agent_logs" on agent_logs for all using (true);
