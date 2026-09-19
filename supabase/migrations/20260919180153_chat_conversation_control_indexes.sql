create index if not exists conversation_mutes_campaign_idx
  on public.conversation_mutes(campaign_id);

create index if not exists conversation_reports_conversation_idx
  on public.conversation_reports(conversation_id);

create index if not exists conversation_reports_reporter_user_idx
  on public.conversation_reports(reporter_user_id);

create index if not exists conversation_reports_reporter_identity_idx
  on public.conversation_reports(reporter_identity_id);

create index if not exists conversation_reports_reported_identity_idx
  on public.conversation_reports(reported_identity_id);
