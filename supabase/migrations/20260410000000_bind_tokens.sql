-- bind_tokens: one-time tokens for web GPS binding
-- Agent generates token → user opens antenna.fyi/locate?token=xxx → web updates location

CREATE TABLE IF NOT EXISTS bind_tokens (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used boolean NOT NULL DEFAULT false
);

-- Index for cleanup
CREATE INDEX IF NOT EXISTS idx_bind_tokens_created ON bind_tokens (created_at);

-- RPC: agent creates a bind token for a device
CREATE OR REPLACE FUNCTION create_bind_token(p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_token uuid;
BEGIN
  INSERT INTO bind_tokens (device_id)
  VALUES (p_device_id)
  RETURNING token INTO v_token;
  
  RETURN json_build_object('token', v_token, 'device_id', p_device_id);
END;
$$;

-- RPC: web verifies token and gets device_id (marks as used)
CREATE OR REPLACE FUNCTION verify_bind_token(p_token uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record bind_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_record
  FROM bind_tokens
  WHERE token = p_token
    AND used = false
    AND created_at > now() - interval '24 hours';
  
  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'error', 'Token expired or already used');
  END IF;
  
  -- Don't mark as used — allow repeated GPS updates from same token within 24h
  -- UPDATE bind_tokens SET used = true WHERE token = p_token;
  
  RETURN json_build_object('valid', true, 'device_id', v_record.device_id);
END;
$$;

-- Cleanup: delete tokens older than 48h (run via pg_cron or manually)
-- SELECT cron.schedule('cleanup-bind-tokens', '0 */6 * * *', $$DELETE FROM bind_tokens WHERE created_at < now() - interval '48 hours'$$);
