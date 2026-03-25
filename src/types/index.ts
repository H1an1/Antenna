export interface Profile {
  id: string;
  device_id: string;
  display_name: string | null;
  line1: string | null;
  line2: string | null;
  line3: string | null;
  emoji: string;
  visible: boolean;
  geohash: string | null;
  location: unknown;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface Match {
  id: string;
  device_id_a: string;
  device_id_b: string;
  reason: string | null;
  score: number | null;
  status: "pending" | "accepted" | "skipped";
  expires_at: string;
  created_at: string;
}

export interface NearbyPerson {
  id: string;
  device_id: string;
  display_name: string | null;
  line1: string | null;
  line2: string | null;
  line3: string | null;
  emoji: string;
  distance_m: number;
  // computed on client from location
  angle: number; // radians, for radar placement
  match?: Match;
}

export type RangeOption = {
  label: string;
  meters: number;
};

export const RANGE_OPTIONS: RangeOption[] = [
  { label: "200m", meters: 200 },
  { label: "500m", meters: 500 },
  { label: "1km", meters: 1000 },
  { label: "2km", meters: 2000 },
];
