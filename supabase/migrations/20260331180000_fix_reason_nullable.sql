-- Fix: allow NULL reason in matches (accept flow doesn't have a reason)
ALTER TABLE matches ALTER COLUMN reason DROP NOT NULL;

-- Update upsert_match to handle NULL reason gracefully
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
  VALUES (p_device_id_a, p_device_id_b, COALESCE(p_reason, ''), p_score, p_status, p_contact_info,
          now() + (p_expires_hours || ' hours')::interval)
  ON CONFLICT (device_id_a, device_id_b) DO UPDATE SET
    reason = COALESCE(NULLIF(p_reason, ''), matches.reason),
    score = COALESCE(p_score, matches.score),
    status = p_status,
    contact_info_a = COALESCE(p_contact_info, matches.contact_info_a),
    expires_at = now() + (p_expires_hours || ' hours')::interval
  RETURNING * INTO result;
  RETURN row_to_json(result);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
