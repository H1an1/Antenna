-- Ensure agent/API profile writes are visible in the dashboard.
-- Dashboard reads profiles by user_id; API writes must set that user_id, not only device_id.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE profiles src
SET profile_slug = NULL
FROM profiles target
WHERE src.user_id IS NULL
  AND src.device_id ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND target.user_id = substring(src.device_id from 6)::uuid
  AND target.device_id <> src.device_id
  AND src.profile_slug IS NOT NULL;

WITH canonical AS (
  SELECT
    p.*,
    substring(p.device_id from 6)::uuid AS inferred_user_id
  FROM profiles p
  WHERE p.user_id IS NULL
    AND p.device_id ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
merged AS (
  UPDATE profiles target
  SET
    display_name = COALESCE(canonical.display_name, target.display_name),
    emoji = COALESCE(canonical.emoji, target.emoji),
    line1 = COALESCE(canonical.line1, target.line1),
    line2 = COALESCE(canonical.line2, target.line2),
    line3 = COALESCE(canonical.line3, target.line3),
    visible = COALESCE(canonical.visible, target.visible),
    matching_context = COALESCE(canonical.matching_context, target.matching_context),
    contact_info = COALESCE(canonical.contact_info, target.contact_info),
    profile_slug = COALESCE(canonical.profile_slug, target.profile_slug),
    embedding = COALESCE(canonical.embedding, target.embedding),
    quality_score = COALESCE(canonical.quality_score, target.quality_score),
    updated_at = now()
  FROM canonical
  WHERE target.user_id = canonical.inferred_user_id
    AND target.device_id <> canonical.device_id
  RETURNING canonical.device_id
)
DELETE FROM profiles p
USING merged
WHERE p.device_id = merged.device_id;

UPDATE profiles
SET user_id = substring(device_id from 6)::uuid
WHERE user_id IS NULL
  AND device_id ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

DROP FUNCTION IF EXISTS upsert_profile(text, text, text, text, text, text, boolean, text, text, text);
DROP FUNCTION IF EXISTS upsert_profile(text, text, text, text, text, text, boolean, text, text, text, text);

CREATE OR REPLACE FUNCTION upsert_profile(
  p_device_id text,
  p_display_name text DEFAULT NULL,
  p_emoji text DEFAULT NULL,
  p_line1 text DEFAULT NULL,
  p_line2 text DEFAULT NULL,
  p_line3 text DEFAULT NULL,
  p_visible boolean DEFAULT true,
  p_matching_context text DEFAULT NULL,
  p_last_chat_id text DEFAULT NULL,
  p_contact_info text DEFAULT NULL,
  p_api_key text DEFAULT NULL
) RETURNS json AS $$
DECLARE
  result profiles;
  v_user_id uuid;
  v_device_id text := p_device_id;
BEGIN
  IF p_api_key IS NOT NULL THEN
    SELECT user_id INTO v_user_id
    FROM api_keys
    WHERE key = p_api_key AND revoked = false;

    IF v_user_id IS NULL THEN
      RETURN json_build_object('error', 'invalid_key', 'message', 'Invalid or revoked API key');
    END IF;

    v_device_id := 'user:' || v_user_id::text;
  END IF;

  IF v_user_id IS NOT NULL THEN
    UPDATE profiles
    SET
      display_name = COALESCE(NULLIF(p_display_name, ''), profiles.display_name),
      emoji = COALESCE(NULLIF(p_emoji, ''), profiles.emoji, '👤'),
      line1 = COALESCE(p_line1, profiles.line1),
      line2 = COALESCE(p_line2, profiles.line2),
      line3 = COALESCE(p_line3, profiles.line3),
      visible = p_visible,
      matching_context = COALESCE(p_matching_context, profiles.matching_context),
      last_chat_id = COALESCE(p_last_chat_id, profiles.last_chat_id),
      contact_info = COALESCE(p_contact_info, profiles.contact_info),
      user_id = v_user_id,
      last_seen_at = now(),
      updated_at = now()
    WHERE profiles.user_id = v_user_id
    RETURNING * INTO result;

    IF FOUND THEN
      RETURN row_to_json(result);
    END IF;
  END IF;

  INSERT INTO profiles (
    device_id,
    display_name,
    emoji,
    line1,
    line2,
    line3,
    visible,
    matching_context,
    last_chat_id,
    contact_info,
    user_id,
    last_seen_at
  )
  VALUES (
    v_device_id,
    p_display_name,
    COALESCE(p_emoji, '👤'),
    p_line1,
    p_line2,
    p_line3,
    p_visible,
    p_matching_context,
    p_last_chat_id,
    p_contact_info,
    v_user_id,
    now()
  )
  ON CONFLICT (device_id) DO UPDATE SET
    display_name = COALESCE(NULLIF(p_display_name, ''), profiles.display_name),
    emoji = COALESCE(NULLIF(p_emoji, ''), profiles.emoji, '👤'),
    line1 = COALESCE(p_line1, profiles.line1),
    line2 = COALESCE(p_line2, profiles.line2),
    line3 = COALESCE(p_line3, profiles.line3),
    visible = p_visible,
    matching_context = COALESCE(p_matching_context, profiles.matching_context),
    last_chat_id = COALESCE(p_last_chat_id, profiles.last_chat_id),
    contact_info = COALESCE(p_contact_info, profiles.contact_info),
    user_id = COALESCE(v_user_id, profiles.user_id),
    last_seen_at = now(),
    updated_at = now()
  RETURNING * INTO result;

  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION upsert_profile(text, text, text, text, text, text, boolean, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION upsert_profile(text, text, text, text, text, text, boolean, text, text, text, text) TO authenticated;
