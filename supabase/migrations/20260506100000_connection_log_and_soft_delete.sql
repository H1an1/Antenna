-- 1. Create connection_log table (永久记录每次 match 和连接)
CREATE TABLE IF NOT EXISTS connection_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id_a text NOT NULL,
  device_id_b text NOT NULL,
  match_id uuid,
  reason text,
  score numeric,
  event_id uuid REFERENCES events(id),
  status text NOT NULL DEFAULT 'matched', -- matched, accepted_a, accepted_b, mutual, expired, rejected
  contact_exchanged boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for querying by user
CREATE INDEX idx_connection_log_device_a ON connection_log(device_id_a);
CREATE INDEX idx_connection_log_device_b ON connection_log(device_id_b);
CREATE INDEX idx_connection_log_created ON connection_log(created_at DESC);
CREATE INDEX idx_connection_log_status ON connection_log(status);

-- RLS: only service_role can read/write (admin analytics)
ALTER TABLE connection_log ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies = locked down to service_role only

-- 2. Change cron: soft-delete matches instead of hard-delete
-- First unschedule the old hard-delete cron
SELECT cron.unschedule('cleanup-expired-matches');

-- Add 'archived' status and archived_at column to matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- New cron: archive expired matches (set status='expired', archived_at=now())
-- instead of deleting them
SELECT cron.schedule(
  'archive-expired-matches',
  '0 * * * *', -- every hour
  $$UPDATE matches SET status = 'expired', archived_at = now() WHERE expires_at < now() AND status != 'expired'$$
);

-- 3. Trigger: auto-log to connection_log on match INSERT or status change
CREATE OR REPLACE FUNCTION log_connection_on_match()
RETURNS trigger AS $$
BEGIN
  -- On INSERT: log initial match creation
  IF TG_OP = 'INSERT' THEN
    INSERT INTO connection_log (match_id, device_id_a, device_id_b, reason, score, status)
    VALUES (NEW.id, NEW.device_id_a, NEW.device_id_b, NEW.reason, NEW.score, COALESCE(NEW.status, 'matched'));
    RETURN NEW;
  END IF;

  -- On UPDATE: log status changes
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE connection_log
    SET status = NEW.status,
        updated_at = now(),
        contact_exchanged = (NEW.contact_info_a IS NOT NULL AND NEW.contact_info_b IS NOT NULL)
    WHERE match_id = NEW.id;

    -- If no row updated (legacy match without log entry), insert one
    IF NOT FOUND THEN
      INSERT INTO connection_log (match_id, device_id_a, device_id_b, reason, score, status, contact_exchanged)
      VALUES (NEW.id, NEW.device_id_a, NEW.device_id_b, NEW.reason, NEW.score, NEW.status,
              (NEW.contact_info_a IS NOT NULL AND NEW.contact_info_b IS NOT NULL));
    END IF;
    RETURN NEW;
  END IF;

  -- On UPDATE: log contact exchange
  IF TG_OP = 'UPDATE' AND
     (OLD.contact_info_a IS DISTINCT FROM NEW.contact_info_a OR OLD.contact_info_b IS DISTINCT FROM NEW.contact_info_b) THEN
    UPDATE connection_log
    SET contact_exchanged = (NEW.contact_info_a IS NOT NULL AND NEW.contact_info_b IS NOT NULL),
        updated_at = now()
    WHERE match_id = NEW.id;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_log_connection
  AFTER INSERT OR UPDATE ON matches
  FOR EACH ROW
  EXECUTE FUNCTION log_connection_on_match();

-- 4. Backfill: log the one existing match
INSERT INTO connection_log (match_id, device_id_a, device_id_b, reason, score, status, contact_exchanged, created_at)
SELECT id, device_id_a, device_id_b, reason, score, status,
       (contact_info_a IS NOT NULL AND contact_info_b IS NOT NULL),
       created_at
FROM matches
ON CONFLICT DO NOTHING;
