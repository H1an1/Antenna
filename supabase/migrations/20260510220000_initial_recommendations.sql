-- initial_recommendations: one-time first-use recommendations (2-3 people)
-- Does NOT consume daily discover quota
-- Can only be used once per user (tracked by initial_recommendations_used table)

CREATE TABLE IF NOT EXISTS initial_recommendations_used (
  device_id text PRIMARY KEY,
  used_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION initial_recommendations(
  p_device_id text,
  p_limit int DEFAULT 3
) RETURNS SETOF profiles
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if already used
  IF EXISTS (SELECT 1 FROM initial_recommendations_used WHERE device_id = p_device_id) THEN
    RETURN;  -- Return empty set
  END IF;

  -- Mark as used
  INSERT INTO initial_recommendations_used (device_id) VALUES (p_device_id)
  ON CONFLICT DO NOTHING;

  -- Return top matches by embedding similarity, excluding self
  RETURN QUERY
  SELECT p.*
  FROM profiles p
  WHERE p.device_id != p_device_id
    AND p.visible = true
    AND p.line1 IS NOT NULL
    AND length(coalesce(p.line1,'') || coalesce(p.line2,'') || coalesce(p.line3,'')) >= 10
    AND p.embedding IS NOT NULL
    AND EXISTS (SELECT 1 FROM profiles me WHERE me.device_id = p_device_id AND me.embedding IS NOT NULL)
  ORDER BY p.embedding <=> (SELECT embedding FROM profiles WHERE device_id = p_device_id)
  LIMIT p_limit;
END;
$$;

-- Security: block anon direct reads
ALTER TABLE initial_recommendations_used ENABLE ROW LEVEL SECURITY;
