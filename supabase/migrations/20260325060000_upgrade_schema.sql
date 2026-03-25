-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add missing columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS line1 text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS line2 text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS line3 text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emoji text DEFAULT '🦐';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS visible boolean DEFAULT true;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location geography(Point, 4326);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now();

-- Add columns to matches if missing
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score float;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '24 hours');

-- Spatial index
CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles USING GIST(location);

-- Nearby function
CREATE OR REPLACE FUNCTION nearby_profiles(
  p_lat float,
  p_lng float,
  p_radius_m int DEFAULT 500
)
RETURNS SETOF profiles AS $$
  SELECT * FROM profiles
  WHERE visible = true
    AND location IS NOT NULL
    AND ST_DWithin(
      location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_m
    )
    AND last_seen_at > now() - interval '1 hour'
  ORDER BY location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
$$ LANGUAGE sql STABLE;
