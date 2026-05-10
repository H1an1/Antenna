-- Ensure user_id column and unique index exist (formalize what was applied directly)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles (user_id) WHERE user_id IS NOT NULL;

-- Drop old insecure version
DROP FUNCTION IF EXISTS bind_user_id(text, uuid);

-- bind_user_id RPC: agent calls this with API key, NOT user_id directly
-- The user_id is resolved from the API key server-side — agent cannot fake it
CREATE OR REPLACE FUNCTION bind_user_id(
  p_device_id text,
  p_api_key text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_existing profiles;
  v_conflict profiles;
BEGIN
  -- 1. Verify API key → extract user_id (server-side, not from agent input)
  SELECT user_id INTO v_user_id
  FROM api_keys
  WHERE key = p_api_key AND revoked = false;

  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'invalid_key', 'message', 'Invalid or revoked API key');
  END IF;

  -- 2. Check target profile exists
  SELECT * INTO v_existing FROM profiles WHERE device_id = p_device_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'device_not_found', 'message', 'No profile found for this device_id');
  END IF;

  -- 3. Already bound to same user_id
  IF v_existing.user_id = v_user_id THEN
    RETURN json_build_object('bound', true, 'device_id', p_device_id, 'user_id', v_user_id);
  END IF;

  -- 4. Already bound to a different user_id
  IF v_existing.user_id IS NOT NULL AND v_existing.user_id != v_user_id THEN
    RETURN json_build_object('error', 'already_bound', 'message', 'This profile is already linked to a different account');
  END IF;

  -- 5. Check if user_id is claimed by another profile
  SELECT * INTO v_conflict FROM profiles WHERE user_id = v_user_id AND device_id != p_device_id;
  IF FOUND THEN
    -- If the conflicting profile is a website-created stub (device_id starts with 'user:'),
    -- delete it and transfer user_id to the real profile
    IF v_conflict.device_id LIKE 'user:%' THEN
      DELETE FROM profiles WHERE device_id = v_conflict.device_id;
    ELSE
      RETURN json_build_object('error', 'user_id_conflict', 'message', 'This account is already linked to another profile');
    END IF;
  END IF;

  -- 6. Bind
  UPDATE profiles SET user_id = v_user_id WHERE device_id = p_device_id;

  RETURN json_build_object('bound', true, 'device_id', p_device_id, 'user_id', v_user_id);
END;
$$;
