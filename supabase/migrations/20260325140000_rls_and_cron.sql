-- RLS policies for Antenna
-- Since we use device_id (no Supabase Auth), we use anon key with custom checks

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read visible profiles, update own via device_id header
CREATE POLICY "Anyone can read visible profiles"
  ON profiles FOR SELECT
  USING (visible = true);

CREATE POLICY "Device can read own profile"
  ON profiles FOR SELECT
  USING (device_id = current_setting('request.headers', true)::json->>'x-device-id');

CREATE POLICY "Device can upsert own profile"
  ON profiles FOR INSERT
  WITH CHECK (device_id = current_setting('request.headers', true)::json->>'x-device-id');

CREATE POLICY "Device can update own profile"
  ON profiles FOR UPDATE
  USING (device_id = current_setting('request.headers', true)::json->>'x-device-id');

-- Matches: device can only see own matches
CREATE POLICY "Device can read own matches"
  ON matches FOR SELECT
  USING (
    device_id_a = current_setting('request.headers', true)::json->>'x-device-id'
    OR device_id_b = current_setting('request.headers', true)::json->>'x-device-id'
  );

CREATE POLICY "Device can update own matches"
  ON matches FOR UPDATE
  USING (
    device_id_a = current_setting('request.headers', true)::json->>'x-device-id'
    OR device_id_b = current_setting('request.headers', true)::json->>'x-device-id'
  );

-- Service role (Edge Functions, agent) can do everything — no policy needed, bypasses RLS

-- pg_cron: auto-cleanup expired matches
-- Enable pg_cron extension first
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule cleanup every hour
SELECT cron.schedule(
  'cleanup-expired-matches',
  '0 * * * *',  -- every hour
  $$DELETE FROM matches WHERE expires_at < now()$$
);

-- Also clean stale profiles (not seen in 7 days)
SELECT cron.schedule(
  'cleanup-stale-profiles',
  '0 3 * * *',  -- daily at 3 AM UTC
  $$DELETE FROM profiles WHERE last_seen_at < now() - interval '7 days'$$
);
