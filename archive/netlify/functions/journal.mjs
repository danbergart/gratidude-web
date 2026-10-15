// Full reverse-chronological journal list + stats.
import { supabase, json, preflight, loadSession } from '../lib/session.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const { anonId } = await req.json().catch(() => ({}));
  const session = await loadSession(req, anonId);
  if (!session) return json({ error: 'No session' }, 401);

  const { state, id, userId } = session;

  const sel = supabase.from('entries').select('entry_date, items, day_num').order('entry_date', { ascending: false });
  const { data: rows } = userId ? await sel.eq('user_id', id) : await sel.eq('anon_id', id);
  const entries = (rows ?? []).map((e) => ({ date: e.entry_date, items: e.items, dayNum: e.day_num }));

  const monthPrefix = new Date().toISOString().slice(0, 7);
  const thisMonth = entries.filter((e) => e.date.startsWith(monthPrefix)).length;

  return json({
    entries,
    stats: { streak: state.streak ?? 0, thisMonth, allTime: entries.length },
  });
};

export const config = { path: '/api/journal' };
