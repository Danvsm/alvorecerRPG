create index cosmetic_grants_granted_by_idx on public.cosmetic_grants(granted_by)
  where granted_by is not null;
create index cosmetic_grants_removed_by_idx on public.cosmetic_grants(removed_by)
  where removed_by is not null;
