// v2 keeps a single setting: the daily reminder.
import { supabase, json, preflight, loadSession } from '../lib/session.mjs';

const PRESETS = ['7:00 am', '12:00 pm', '6:00 pm', '8:00 pm', '9:30 pm'];
const isTime = (v) => typeof v === 'string' && (PRESETS.includes(v) || /^([01]?\d|2[0-3]):[0-5]\d$/.test(v));

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const body = await req.json();
  const session = await loadSession(req, body.anonId);
  if (!session) return json({ error: 'No session' }, 401);

  const { state, table, id } = session;
  const patch = {};

  if (typeof body.enabled === 'boolean') patch.notif_enabled = body.enabled;
  if (isTime(body.time)) patch.reminder_time = body.time;

  if (Object.keys(patch).length) await supabase.from(table).update(patch).eq('id', id);

  const next = { ...state, ...patch };
  return json({ reminder: { enabled: next.notif_enabled ?? false, time: next.reminder_time ?? '8:00 pm' } });
};

export const config = { path: '/api/settings' };
