-- Enable RLS on all tables and lock down direct access
-- All legitimate writes go through SECURITY DEFINER RPCs

-- ═══════════════════════════════════════════════════════════════════
-- profiles
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- anon can read visible profiles only (for nearby_profiles fallback)
CREATE POLICY "anon_read_visible_profiles" ON profiles
  FOR SELECT TO anon
  USING (visible = true);

-- No direct insert/update/delete for anon — must use RPCs
-- (SECURITY DEFINER RPCs bypass RLS)

-- ═══════════════════════════════════════════════════════════════════
-- matches
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- No direct access for anon at all — everything goes through RPCs
-- (No policy = deny all for anon)

-- ═══════════════════════════════════════════════════════════════════
-- Verify: SECURITY DEFINER RPCs still work because they run as
-- the function owner (postgres), bypassing RLS entirely.
-- ═══════════════════════════════════════════════════════════════════
