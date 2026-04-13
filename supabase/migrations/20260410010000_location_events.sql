-- location_events: real-time notification when web GPS updates
-- Web writes here → Plugin subscribes via Supabase Realtime → triggers scan

CREATE TABLE IF NOT EXISTS location_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable Realtime on this table
ALTER PUBLICATION supabase_realtime ADD TABLE location_events;

-- RPC: web page calls this after GPS update
CREATE OR REPLACE FUNCTION insert_location_event(p_device_id text, p_lat double precision, p_lng double precision)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO location_events (device_id, lat, lng)
  VALUES (p_device_id, p_lat, p_lng);
  
  -- Cleanup: keep only last 24h
  DELETE FROM location_events WHERE created_at < now() - interval '24 hours';
  
  RETURN json_build_object('ok', true);
END;
$$;
