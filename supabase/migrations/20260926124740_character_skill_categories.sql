-- Existing abilities remain active; passive abilities have no resource cost.
alter table public.character_skills
  add column skill_type text not null default 'active'
    check (skill_type in ('active', 'passive')),
  add constraint character_skill_passive_no_cost
    check (skill_type <> 'passive' or (cost_amount = 0 and other_cost_label = ''));
