// Shared session loading + helpers for the Netlify functions.
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export function todayStr() { return new Date().toISOString().split('T')[0]; }

export function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export function preflight() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

/** Resolves the caller to a signed-up user id, or null. */
export async function getUserId(req) {
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!jwt) return null;
  const { data: { user } } = await supabase.auth.getUser(jwt);
  return user?.id ?? null;
}

/**
 * Loads (creating if needed) the row for this caller.
 * Returns { state, table, id, userId } or null when there is no session at all.
 */
export async function loadSession(req, anonId) {
  const userId = await getUserId(req);
  const today = todayStr();

  if (userId) {
    let { data } = await supabase.from('web_users').select('*').eq('id', userId).single();
    if (!data) {
      await supabase.from('web_users').insert({ id: userId, last_session_date: today });
      ({ data } = await supabase.from('web_users').select('*').eq('id', userId).single());
    }
    return { state: data, table: 'web_users', id: userId, userId };
  }

  if (anonId) {
    let { data } = await supabase.from('anon_sessions').select('*').eq('id', anonId).single();
    if (!data) {
      await supabase.from('anon_sessions').insert({ id: anonId, last_session_date: today });
      ({ data } = await supabase.from('anon_sessions').select('*').eq('id', anonId).single());
    }
    return { state: data, table: 'anon_sessions', id: anonId, userId: null };
  }

  return null;
}

/** The settings slice the frontend cares about. */
export function publicSettings(s) {
  return {
    personality: s.personality ?? 0,
    level: s.level ?? 1,
    team: s.team ?? '',
    displayName: s.display_name ?? '',
    sounds: s.sounds ?? true,
    notifEnabled: s.notif_enabled ?? false,
    reminderTime: s.reminder_time ?? '8:00 pm',
    onboarded: s.onboarded ?? false,
  };
}
