-- The existing conversation_reads table is the source of truth for read
-- receipts. Publishing it lets the sender see the peer's read_at advance
-- without polling. Its existing RLS policy still limits events to people who
-- can access the conversation.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_reads'
  ) then
    alter publication supabase_realtime
      add table public.conversation_reads;
  end if;
end
$$;
