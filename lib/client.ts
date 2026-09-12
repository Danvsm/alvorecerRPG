"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let instance: SupabaseClient<any> | null = null;
export function browserDb() {
  if (!instance)
    instance = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  return instance;
}
export const configured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
