-- Make the intentionally RPC-only access model explicit in RLS as well as
-- grants. The SECURITY DEFINER functions validate public input and verify the
-- authenticated campaign master before touching this private table.
drop policy if exists recruitment_applications_no_direct_access
  on alvorecer_private.recruitment_applications;

create policy recruitment_applications_no_direct_access
  on alvorecer_private.recruitment_applications
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
