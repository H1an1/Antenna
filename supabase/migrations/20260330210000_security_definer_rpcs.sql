-- Make RPCs SECURITY DEFINER so they work with anon key

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC for profile upsert (with name card fields)
CREATE OR REPLACE FUNCTION upsert_profile(
  p_device_id text,
  p_display_name text DEFAULT NULL,
  p_emoji text DEFAULT NULL,
  p_line1 text DEFAULT NULL,
  p_line2 text DEFAULT NULL,
  p_line3 text DEFAULT NULL,
  p_visible boolean DEFAULT true
) RETURNS json AS $$
DECLARE
  result profiles;
BEGIN
  INSERT INTO profiles (device_id, display_name, emoji, line1, line2, line3, visible, last_seen_at)
  VALUES (p_device_id, p_display_name, p_emoji, p_line1, p_line2, p_line3, p_visible, now())
  ON CONFLICT (device_id) DO UPDATE SET
    display_name = COALESCE(NULLIF(p_display_name, ''), profiles.display_name),
    emoji = COALESCE(NULLIF(p_emoji, ''), profiles.emoji),
    line1 = COALESCE(p_line1, profiles.line1),
    line2 = COALESCE(p_line2, profiles.line2),
    line3 = COALESCE(p_line3, profiles.line3),
    visible = p_visible,
    last_seen_at = now()
  RETURNING * INTO result;
  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC for match upsert
CREATE OR REPLACE FUNCTION upsert_match(
  p_device_id_a text,
  p_device_id_b text,
  p_reason text DEFAULT NULL,
  p_score float DEFAULT 0,
  p_status text DEFAULT 'pending',
  p_contact_info text DEFAULT NULL,
  p_expires_hours int DEFAULT 24
) RETURNS json AS $$
DECLARE
  result matches;
BEGIN
  INSERT INTO matches (device_id_a, device_id_b, reason, score, status, contact_info_a, expires_at)
  VALUES (p_device_id_a, p_device_id_b, p_reason, p_score, p_status, p_contact_info,
          now() + (p_expires_hours || ' hours')::interval)
  ON CONFLICT (device_id_a, device_id_b) DO UPDATE SET
    reason = COALESCE(p_reason, matches.reason),
    score = COALESCE(p_score, matches.score),
    status = p_status,
    contact_info_a = COALESCE(p_contact_info, matches.contact_info_a),
    expires_at = now() + (p_expires_hours || ' hours')::interval
  RETURNING * INTO result;
  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Make nearby_profiles SECURITY DEFINER too
CREATE OR REPLACE FUNCTION nearby_profiles(p_lat float, p_lng float, p_radius_m int DEFAULT 500)
RETURNS SETOF profiles AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM profiles
  WHERE visible = true
    AND location IS NOT NULL
    AND ST_DWithin(
      location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radius_m
    )
    AND last_seen_at > now() - interval '24 hours'
  ORDER BY ST_Distance(
    location,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC for getting a single profile by device_id
CREATE OR REPLACE FUNCTION get_profile(p_device_id text)
RETURNS json AS $$
DECLARE
  result profiles;
BEGIN
  SELECT * INTO result FROM profiles WHERE device_id = p_device_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC for checking matches
CREATE OR REPLACE FUNCTION get_my_matches(p_device_id text)
RETURNS json AS $$
BEGIN
  RETURN (
    SELECT json_agg(row_to_json(m))
    FROM matches m
    WHERE (m.device_id_a = p_device_id OR m.device_id_b = p_device_id)
      AND m.expires_at > now()
      AND m.status = 'accepted'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
