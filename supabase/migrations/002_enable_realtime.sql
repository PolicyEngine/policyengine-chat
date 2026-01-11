-- Enable realtime for messages and agent_logs tables
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table agent_logs;
