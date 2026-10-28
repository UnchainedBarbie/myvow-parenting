-- One approval of one final text is one send attempt.
-- The client sends the same attempt id with every retry of that approval; a retry returns the
-- saved message. A new approval carries a new id, so identical text can be sent twice on purpose.
alter table public.messages
  add column if not exists send_attempt_id text;

create unique index if not exists messages_sender_send_attempt_uniq
  on public.messages (sender_id, send_attempt_id)
  where send_attempt_id is not null;

notify pgrst, 'reload schema';
