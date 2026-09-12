-- Historical charges keep their human-readable snapshots even after both the
-- user and character are removed. New charges are still validated by the
-- wallet_action server function before insertion.
alter table public.dracma_charges
  drop constraint if exists dracma_charges_check,
  drop constraint if exists dracma_charges_check1;

alter table public.dracma_transactions
  drop constraint if exists dracma_transactions_check;
