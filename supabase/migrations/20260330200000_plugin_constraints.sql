-- Ensure unique constraints needed by the plugin's upsert operations

-- Unique device_id for profile upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_device_id_key'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_device_id_key UNIQUE (device_id);
  END IF;
END $$;

-- Unique (device_id_a, device_id_b) for match upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matches_device_id_pair_key'
  ) THEN
    ALTER TABLE matches ADD CONSTRAINT matches_device_id_pair_key UNIQUE (device_id_a, device_id_b);
  END IF;
END $$;

-- Add 'reason' column to matches if missing
ALTER TABLE matches ADD COLUMN IF NOT EXISTS reason text;

-- Helper RPC: upsert profile with location (avoids WKT string issues)
CREATE OR REPLACE FUNCTION upsert_profile_location(
  p_device_id text,
  p_lng float,
  p_lat float
) RETURNS void AS $$
BEGIN
  INSERT INTO profiles (device_id, location, last_seen_at, visible)
  VALUES (
    p_device_id,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    now(),
    true
  )
  ON CONFLICT (device_id) DO UPDATE SET
    location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    last_seen_at = now();
END;
$$ LANGUAGE plpgsql;

-- Helper RPC: update location only
CREATE OR REPLACE FUNCTION update_location(
  p_device_id text,
  p_lng float,
  p_lat float
) RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      last_seen_at = now()
  WHERE device_id = p_device_id;
END;
$$ LANGUAGE plpgsql;
