-- Update get_profile_by_slug: 
--   - Remove emoji from return
--   - Rename matching_context → more_information in output
--   - Add device_id to return (needed for agent accept-via-slug)
--   - line1/2/3 labels match dashboard: personal_description, looking_for, our_conversation

CREATE OR REPLACE FUNCTION get_profile_by_slug(p_slug text)
RETURNS json AS $$
DECLARE
  result profiles;
BEGIN
  SELECT * INTO result FROM profiles WHERE profile_slug = p_slug AND visible = true;
  IF NOT FOUND THEN
    RETURN json_build_object('found', false);
  END IF;
  RETURN json_build_object(
    'found', true,
    'device_id', result.device_id,
    'user_id', result.user_id,
    'display_name', result.display_name,
    'profile_slug', result.profile_slug,
    'personal_description', result.line1,
    'looking_for', result.line2,
    'our_conversation', result.line3,
    'more_information', result.matching_context
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
