-- Add tool_logs column to messages for persisting agent logs
alter table messages add column if not exists tool_logs jsonb;

-- Add message_id to agent_logs for associating logs with messages
alter table agent_logs add column if not exists message_id uuid references messages(id) on delete cascade;
create index if not exists agent_logs_message_id_idx on agent_logs(message_id);
