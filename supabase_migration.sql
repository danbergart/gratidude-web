-- Run in Supabase SQL Editor

-- Signed-up users
CREATE TABLE IF NOT EXISTS web_users (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  day                  INTEGER NOT NULL DEFAULT 1,
  grats_today          INTEGER NOT NULL DEFAULT 0,
  day_closed           BOOLEAN NOT NULL DEFAULT false,
  last_session_date    DATE,
  streak               INTEGER NOT NULL DEFAULT 0,
  last_streak_date     DATE,
  conversation_history JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE web_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_row" ON web_users
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Anonymous sessions (no account required)
CREATE TABLE IF NOT EXISTS anon_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day                  INTEGER NOT NULL DEFAULT 1,
  grats_today          INTEGER NOT NULL DEFAULT 0,
  day_closed           BOOLEAN NOT NULL DEFAULT false,
  last_session_date    DATE,
  streak               INTEGER NOT NULL DEFAULT 0,
  last_streak_date     DATE,
  msg_count_today      INTEGER NOT NULL DEFAULT 0,
  last_msg_date        DATE,
  conversation_history JSONB NOT NULL DEFAULT '[]',
  transferred          BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service key bypasses RLS; no client-side access needed
ALTER TABLE anon_sessions ENABLE ROW LEVEL SECURITY;
