import { supabase, json, preflight, loadSession } from '../lib/session.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const { anonId } = await req.json();
  const session = await loadSession(req, anonId);
  if (!session) return json({ error: 'No session' }, 401);

  const { state, id, userId } = session;

  const q = supabase.from('entries').select('entry_date, items, day_num').order('entry_date', { ascending: true });
  const { data: entries } = userId ? await q.eq('user_id', id) : await q.eq('anon_id', id);

  const rows = entries ?? [];
  const byDate = {};
  for (const e of rows) byDate[e.entry_date] = { items: e.items, dayNum: e.day_num };

  return json({
    entries: byDate,
    stats: { streak: state.streak ?? 0, allTime: rows.length },
  });
};

export const config = { path: '/api/journal' };
