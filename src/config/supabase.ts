import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Set device ID header for RLS policies */
export function setDeviceHeader(deviceId: string) {
  // @ts-ignore — supabase-js allows custom headers via global options
  supabase.headers = {
    ...supabase.headers,
    "x-device-id": deviceId,
  };
}
