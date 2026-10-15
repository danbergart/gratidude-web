-- Run in Supabase SQL Editor. Safe to re-run.
-- Adds settings columns + the journal entries table.

-- ── Settings columns ────────────────────────────────────────────────────────
ALTER TABLE web_users     ADD COLUMN IF NOT EXISTS personality   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_users     ADD COLUMN IF NOT EXISTS level         INTEGER NOT NULL DEFAULT 1;
ALTER TABLE web_users     ADD COLUMN IF NOT EXISTS team          TEXT;
ALTER TABLE web_users     ADD COLUMN IF NOT EXISTS display_name  TEXT;
ALTER TABLE web_users     ADD COLUMN IF NOT EXISTS sounds        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE web_users     ADD COLUMN IF NOT EXISTS notif_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE web_users     ADD COLUMN IF NOT EXISTS reminder_time TEXT NOT NULL DEFAULT '8:00 pm';
ALTER TABLE web_users     ADD COLUMN IF NOT EXISTS onboarded     BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE anon_sessions ADD COLUMN IF NOT EXISTS personality   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE anon_sessions ADD COLUMN IF NOT EXISTS level         INTEGER NOT NULL DEFAULT 1;
ALTER TABLE anon_sessions ADD COLUMN IF NOT EXISTS team          TEXT;
ALTER TABLE anon_sessions ADD COLUMN IF NOT EXISTS display_name  TEXT;
ALTER TABLE anon_sessions ADD COLUMN IF NOT EXISTS sounds        BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE anon_sessions ADD COLUMN IF NOT EXISTS notif_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE anon_sessions ADD COLUMN IF NOT EXISTS reminder_time TEXT NOT NULL DEFAULT '8:00 pm';
ALTER TABLE anon_sessions ADD COLUMN IF NOT EXISTS onboarded     BOOLEAN NOT NULL DEFAULT false;

-- ── Journal entries ─────────────────────────────────────────────────────────
-- One row per completed day. `items` holds the three gratitudes as a JSON array.
CREATE TABLE IF NOT EXISTS entries (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  anon_id     UUID,
  entry_date  DATE NOT NULL,
  items       JSONB NOT NULL DEFAULT '[]',
  day_num     INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entries_owner CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS entries_user_date ON entries (user_id, entry_date) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS entries_anon_date ON entries (anon_id, entry_date) WHERE anon_id IS NOT NULL;

-- Service key bypasses RLS; the frontend never touches this table directly.
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;

-- ── Feedback (Send feedback screen) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS web_feedback (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID,
  anon_id    UUID,
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE web_feedback ENABLE ROW LEVEL SECURITY;
