-- SafeZone schema. Idempotent: safe to run repeatedly.
-- Design rules: no continuous location history; geofence checks run on the device and only
-- validated enter/exit events are stored; coordinates exist only for zones, SOS alerts and
-- explicit check-ins.

CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role              text NOT NULL CHECK (role IN ('child', 'guardian', 'admin')),
  email             text NOT NULL,
  full_name         text NOT NULL,
  password_hash     text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated', 'suspended')),
  date_of_birth     date,
  guardian_verified boolean NOT NULL DEFAULT false,
  failed_attempts   integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deactivated_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  device_hash text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  user_agent  text,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_hash)
);

-- A guardian can only see a child's data through an ACTIVE link that the child has consented to.
CREATE TABLE IF NOT EXISTS guardian_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_by       text NOT NULL CHECK (initiated_by IN ('child', 'guardian')),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'revoked', 'declined')),
  child_consented_at timestamptz,
  paused_at          timestamptz,
  paused_reason      text,          -- visible to the child and to administrators only
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  ended_at           timestamptz,
  CHECK (child_id <> guardian_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS guardian_links_open_uq
  ON guardian_links (child_id, guardian_id) WHERE status IN ('pending', 'active', 'paused');
CREATE INDEX IF NOT EXISTS guardian_links_guardian_idx ON guardian_links (guardian_id, status);
CREATE INDEX IF NOT EXISTS guardian_links_child_idx ON guardian_links (child_id, status);

CREATE TABLE IF NOT EXISTS sharing_settings (
  child_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  share_zone_events boolean NOT NULL DEFAULT true,
  share_sos_location boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safe_zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  center_lat double precision NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng double precision NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  radius_m   integer NOT NULL CHECK (radius_m BETWEEN 100 AND 500),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safe_zones_child_idx ON safe_zones (child_id);

-- Server-side event validation state, one row per zone. Holds only inside/outside, never coordinates.
CREATE TABLE IF NOT EXISTS zone_states (
  zone_id         uuid PRIMARY KEY REFERENCES safe_zones(id) ON DELETE CASCADE,
  child_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  confirmed_state text CHECK (confirmed_state IN ('inside', 'outside')),
  confirmed_at    timestamptz,
  cand_state      text CHECK (cand_state IN ('inside', 'outside')),
  cand_count      integer NOT NULL DEFAULT 0,
  cand_first_at   timestamptz
);

CREATE TABLE IF NOT EXISTS location_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id     uuid NOT NULL REFERENCES safe_zones(id) ON DELETE CASCADE,
  child_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN ('enter', 'exit')),
  accuracy_m  integer,
  notified    boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS location_events_child_time_idx ON location_events (child_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS location_events_zone_idx ON location_events (zone_id, event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  display_name    text NOT NULL,
  phone           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_user_id IS NOT NULL OR phone IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS emergency_contacts_child_idx ON emergency_contacts (child_id);

-- A check-in is an explicit, one-time "share my location now" by the child. It expires.
CREATE TABLE IF NOT EXISTS checkins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat        double precision NOT NULL,
  lng        double precision NOT NULL,
  accuracy_m integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS checkins_child_idx ON checkins (child_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sos_alerts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL,          -- makes retries from a queued offline alert idempotent
  lat                double precision,
  lng                double precision,
  accuracy_m         integer,
  triggered_at       timestamptz NOT NULL,   -- when the child pressed the button (device clock, clamped)
  server_received_at timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received', 'notified', 'no_recipients', 'acknowledged', 'resolved')),
  recipients_count   integer NOT NULL DEFAULT 0,
  acknowledged_at    timestamptz,
  acknowledged_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at        timestamptz,
  UNIQUE (child_id, client_id)
);
CREATE INDEX IF NOT EXISTS sos_alerts_child_idx ON sos_alerts (child_id, triggered_at DESC);

CREATE TABLE IF NOT EXISTS incident_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category        text NOT NULL CHECK (category IN ('harassment', 'suspicious_behavior', 'unsafe_place', 'other')),
  description_enc text NOT NULL,             -- AES-256-GCM encrypted at the application level
  occurred_at     timestamptz,
  visibility      text NOT NULL DEFAULT 'admin_only' CHECK (visibility IN ('admin_only', 'admin_and_guardians')),
  status          text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'closed')),
  admin_note_enc  text,
  reviewed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS incident_reports_status_idx ON incident_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS incident_reports_child_idx ON incident_reports (child_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('zone', 'sos', 'system')),
  urgent          boolean NOT NULL DEFAULT false,
  title           text NOT NULL,
  body            text NOT NULL,
  source_type     text,
  source_id       uuid,
  dedupe_key      text,
  delivery_status text NOT NULL DEFAULT 'delivered_in_app' CHECK (delivery_status IN ('delivered_in_app', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uq ON notifications (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role  text,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  ip          text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- never holds coordinates
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON audit_logs (target_type, target_id);
CREATE INDEX IF NOT EXISTS audit_logs_time_idx ON audit_logs (created_at DESC);

-- Audit logs are append-only. Only the retention job (which sets safezone.retention) may delete old rows.
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('safezone.retention', true), '') <> 'on' THEN
    RAISE EXCEPTION 'audit_logs rows can only be deleted by the retention job';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_guard_trg ON audit_logs;
CREATE TRIGGER audit_logs_guard_trg BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();
