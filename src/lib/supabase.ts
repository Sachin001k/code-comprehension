import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseEnabled = !!url && !!key && !url.includes('YOUR-PROJECT');

export const supabase: SupabaseClient | null = supabaseEnabled ? createClient(url!, key!) : null;

export const UNLOCK_ALL_ENV = import.meta.env.VITE_UNLOCK_ALL === 'true';
