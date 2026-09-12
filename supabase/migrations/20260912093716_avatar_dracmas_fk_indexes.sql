create index campaign_avatars_created_by_idx
  on public.campaign_avatars(created_by);

create index dracma_transactions_actor_id_idx
  on public.dracma_transactions(actor_id);
