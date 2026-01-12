-- Add token tracking columns to threads
alter table threads add column if not exists input_tokens bigint default 0;
alter table threads add column if not exists output_tokens bigint default 0;
