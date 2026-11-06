-- One Sage proposal id may be stored on one message. Messages cannot be deleted,
-- so this index is created only when no proposal id is already stored twice.
-- Existing duplicates are reported and the migration stops. Nothing is changed.

do $$
declare
  duplicates text;
begin
  select string_agg(
    format('sage_proposal_id=%s message_ids=%s', sage_proposal_id, message_ids),
    E'\n'
    order by sage_proposal_id
  )
  into duplicates
  from (
    select
      sage_proposal_id,
      string_agg(id::text, ', ' order by created_at, id) as message_ids
    from public.messages
    where sage_proposal_id is not null
    group by sage_proposal_id
    having count(*) > 1
  ) found;

  if duplicates is not null then
    raise exception
      using message =
        'Cannot add a unique index on messages.sage_proposal_id. These proposal ids are already stored on more than one message, and a message cannot be deleted:'
        || E'\n' || duplicates;
  end if;
end $$;

create unique index if not exists messages_sage_proposal_id_uniq
  on public.messages (sage_proposal_id)
  where sage_proposal_id is not null;

notify pgrst, 'reload schema';
