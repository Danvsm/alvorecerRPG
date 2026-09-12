-- Trigger helpers are never valid API endpoints.
revoke execute on function public.enrich_dracma_transaction()
  from public, anon, authenticated;
revoke execute on function public.log_purchase_transaction()
  from public, anon, authenticated;

create index if not exists dracma_transactions_reversed_by_idx
  on public.dracma_transactions(reversed_by);
create index if not exists dracma_transactions_reversal_transaction_idx
  on public.dracma_transactions(reversal_transaction_id);
