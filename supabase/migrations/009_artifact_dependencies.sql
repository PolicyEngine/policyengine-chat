-- Add dependencies column to artifacts table
alter table artifacts add column if not exists dependencies jsonb default '[]'::jsonb;
