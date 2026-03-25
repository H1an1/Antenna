import { supabase } from "../config/supabase";
import type { Profile, Match } from "../types";

/** Get profile for a device */
export async function getProfile(deviceId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("device_id", deviceId)
    .single();

  if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
  return (data as Profile) ?? null;
}

/** Upsert profile — creates or updates based on device_id */
export async function updateProfile(
  deviceId: string,
  profile: Partial<Pick<Profile, "display_name" | "line1" | "line2" | "line3" | "emoji" | "visible">>
) {
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      { device_id: deviceId, ...profile, updated_at: new Date().toISOString() },
      { onConflict: "device_id" }
    )
    .select()
    .single();

  if (error) throw error;
  return data as Profile;
}

/** Update location for a device */
export async function updateLocation(
  deviceId: string,
  lat: number,
  lng: number,
  geohash: string
) {
  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        device_id: deviceId,
        geohash,
        location: `POINT(${lng} ${lat})`,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "device_id" }
    );

  if (error) throw error;
}

/** Get nearby profiles via PostGIS RPC */
export async function getNearby(
  lat: number,
  lng: number,
  radiusM: number = 500
): Promise<Profile[]> {
  const { data, error } = await supabase.rpc("nearby_profiles", {
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radiusM,
  });

  if (error) throw error;
  return (data ?? []) as Profile[];
}

/** Get unexpired matches for a device */
export async function getMatches(deviceId: string): Promise<Match[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .or(`device_id_a.eq.${deviceId},device_id_b.eq.${deviceId}`)
    .gt("expires_at", new Date().toISOString())
    .neq("status", "skipped")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Match[];
}

/** Accept or skip a match */
export async function respondToMatch(
  matchId: string,
  status: "accepted" | "skipped"
) {
  const { error } = await supabase
    .from("matches")
    .update({ status })
    .eq("id", matchId);

  if (error) throw error;
}
