grant delete on table public.conversation_reports to authenticated;

drop policy if exists conversation_reports_master_delete
  on public.conversation_reports;

create policy conversation_reports_master_delete
on public.conversation_reports
for delete
to authenticated
using (public.is_master(campaign_id));
