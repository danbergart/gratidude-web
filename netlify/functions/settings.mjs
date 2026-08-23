import { supabase, json, preflight, loadSession, publicSettings } from '../lib/session.mjs';
import { PERSONALITIES, LEVELS, REMINDER_TIMES } from '../lib/persona.mjs';

const clampInt = (v, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < max ? n : null;
};

const clampText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null);

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const body = await req.json();
  const session = await loadSession(req, body.anonId);
  if (!session) return json({ error: 'No session' }, 401);

  const { state, table, id } = session;
  const patch = {};

  const personality = clampInt(body.personality, PERSONALITIES.length);
  if (personality !== null) patch.personality = personality;

  const level = clampInt(body.level, LEVELS.length);
  if (level !== null) patch.level = level;

  const team = clampText(body.team, 60);
  if (team !== null) patch.team = team;

  const displayName = clampText(body.displayName, 40);
  if (displayName !== null) patch.display_name = displayName;

  if (typeof body.sounds === 'boolean') patch.sounds = body.sounds;
  if (typeof body.notifEnabled === 'boolean') patch.notif_enabled = body.notifEnabled;
  if (typeof body.onboarded === 'boolean') patch.onboarded = body.onboarded;

  if (typeof body.reminderTime === 'string' && REMINDER_TIMES.includes(body.reminderTime)) {
    patch.reminder_time = body.reminderTime;
  }

  if (Object.keys(patch).length) {
    await supabase.from(table).update(patch).eq('id', id);
  }

  return json({ settings: publicSettings({ ...state, ...patch }) });
};

export const config = { path: '/api/settings' };
