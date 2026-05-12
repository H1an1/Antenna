-- Dashboard match lookup should not suppress accepts just because the actor profile
-- is not fully linked yet. Resolve the dashboard account when available, but keep
-- incoming rows visible even if the accepting side has no profile row.

CREATE OR REPLACE FUNCTION get_my_matches_with_profiles(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_result jsonb;
BEGIN
  SELECT user_id INTO v_user_id
  FROM profiles
  WHERE device_id = p_device_id
  LIMIT 1;

  WITH my_device_ids AS (
    SELECT p_device_id AS device_id
    UNION
    SELECT device_id
    FROM profiles
    WHERE v_user_id IS NOT NULL
      AND user_id = v_user_id
  ),
  my_matches AS (
    SELECT m.*
    FROM matches m
    WHERE m.device_id_a IN (SELECT device_id FROM my_device_ids)
      AND m.expires_at > now()
      AND m.status = 'accepted'
  ),
  incoming AS (
    SELECT m.*
    FROM matches m
    WHERE m.device_id_b IN (SELECT device_id FROM my_device_ids)
      AND m.expires_at > now()
      AND m.status = 'accepted'
  ),
  mutual AS (
    SELECT DISTINCT ON (m.device_id_b)
      m.device_id_b AS target_id,
      i.contact_info_a AS their_contact,
      m.contact_info_a AS my_contact,
      p.display_name,
      p.line1,
      p.line2,
      p.line3,
      p.matching_context,
      p.profile_slug,
      p.contact_info AS profile_contact_info,
      m.created_at
    FROM my_matches m
    JOIN incoming i ON i.device_id_a = m.device_id_b
    LEFT JOIN profiles p ON p.device_id = m.device_id_b
    ORDER BY m.device_id_b, m.created_at DESC
  ),
  incoming_only AS (
    SELECT DISTINCT ON (i.device_id_a)
      i.device_id_a AS target_id,
      p.display_name,
      p.line1,
      p.line2,
      p.line3,
      p.matching_context,
      p.profile_slug,
      i.created_at
    FROM incoming i
    LEFT JOIN my_matches m ON m.device_id_b = i.device_id_a
    LEFT JOIN profiles p ON p.device_id = i.device_id_a
    WHERE m.device_id_a IS NULL
    ORDER BY i.device_id_a, i.created_at DESC
  )
  SELECT jsonb_build_object(
    'mutual_matches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'target_id', target_id,
        'name', COALESCE(display_name, '匿名'),
        'line1', line1,
        'line2', line2,
        'line3', line3,
        'matching_context', matching_context,
        'profile_slug', profile_slug,
        'their_contact', their_contact,
        'you_shared', my_contact,
        'profile_contact_info', profile_contact_info
      ) ORDER BY created_at DESC)
      FROM mutual
    ), '[]'::jsonb),
    'incoming_accepts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'target_id', target_id,
        'name', COALESCE(display_name, '匿名'),
        'line1', line1,
        'line2', line2,
        'line3', line3,
        'matching_context', matching_context,
        'profile_slug', profile_slug
      ) ORDER BY created_at DESC)
      FROM incoming_only
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_matches_with_profiles(text) TO anon;
GRANT EXECUTE ON FUNCTION get_my_matches_with_profiles(text) TO authenticated;
