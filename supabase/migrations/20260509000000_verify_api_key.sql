-- Verify an API key and return the associated device_id
-- Callable by anon role so the CLI can authenticate before having a session
CREATE OR REPLACE FUNCTION public.verify_api_key(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_device_id text;
  v_display_name text;
BEGIN
  -- Look up the key
  SELECT user_id INTO v_user_id
  FROM public.api_keys
  WHERE key = p_key AND revoked = false;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid or revoked API key');
  END IF;

  -- Update last_used_at
  UPDATE public.api_keys SET last_used_at = now() WHERE key = p_key;

  -- Get the user's profile
  SELECT device_id, display_name INTO v_device_id, v_display_name
  FROM public.profiles
  WHERE user_id = v_user_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'valid', true,
    'user_id', v_user_id,
    'device_id', COALESCE(v_device_id, 'user:' || v_user_id::text),
    'display_name', v_display_name
  );
END;
$$;

-- Allow anon to call verify_api_key
GRANT EXECUTE ON FUNCTION public.verify_api_key(text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_api_key(text) TO authenticated;
