create index jokenpo_rounds_campaign_idx
  on public.jokenpo_rounds(campaign_id);

create index jokenpo_rounds_character_idx
  on public.jokenpo_rounds(character_id)
  where character_id is not null;
