import { getNearby, getMatches } from "./api";
import { supabase } from "../config/supabase";
import type { Profile, Match, NearbyPerson } from "../types";

/** Calculate distance between two lat/lng points in meters */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Calculate bearing angle from point 1 to point 2 */
function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return Math.atan2(y, x);
}

/** Fetch nearby people with distance and angle computed */
export async function fetchNearbyPeople(
  myLat: number,
  myLng: number,
  radiusM: number,
  myDeviceId: string
): Promise<NearbyPerson[]> {
  // Trigger Edge Function to generate new matches (fire and forget)
  supabase.functions.invoke("match-nearby", {
    body: { device_id: myDeviceId, lat: myLat, lng: myLng, radius_m: radiusM },
  }).catch(() => {});

  const [profiles, matches] = await Promise.all([
    getNearby(myLat, myLng, radiusM),
    getMatches(myDeviceId),
  ]);

  const matchMap = new Map<string, Match>();
  for (const m of matches) {
    matchMap.set(m.device_id_a, m);
    matchMap.set(m.device_id_b, m);
  }

  return profiles
    .filter((p) => p.device_id !== myDeviceId)
    .map((p) => {
      // Parse location point - rough extraction
      let pLat = myLat;
      let pLng = myLng;
      if (p.location && typeof p.location === "string") {
        const match = p.location.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
        if (match) {
          pLng = parseFloat(match[1]);
          pLat = parseFloat(match[2]);
        }
      }

      const distance_m = haversineDistance(myLat, myLng, pLat, pLng);
      const angle = bearing(myLat, myLng, pLat, pLng);

      return {
        id: p.id,
        device_id: p.device_id,
        display_name: p.display_name,
        line1: p.line1,
        line2: p.line2,
        line3: p.line3,
        emoji: p.emoji,
        distance_m,
        angle,
        match: matchMap.get(p.device_id),
      };
    });
}
