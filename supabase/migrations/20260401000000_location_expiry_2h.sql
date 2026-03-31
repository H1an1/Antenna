-- Location expiry: only show profiles active in last 2 hours (was 24h)

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
    AND last_seen_at > now() - interval '2 hours'
  ORDER BY ST_Distance(
    location,
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
