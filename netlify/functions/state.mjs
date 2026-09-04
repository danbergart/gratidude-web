// Current state for the home + done screens: day, streak, today's entry,
// reminder settings, and a few recent days. No AI.
import { supabase, todayStr, json, preflight, loadSession } from '../lib/session.mjs';
import { pickResurfaced } from '../lib/resurface.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const { anonId } = await req.json().catch(() => ({}));
  const session = await loadSession(req, anonId);
  if (!session) return json({ error: 'No session' }, 401);

  let { state, table, id, userId } = session;
  const today = todayStr();

  // New calendar day: reopen the day for a fresh entry.
  if (state.last_session_date && state.last_session_date !== today && state.day_closed) {
    const reset = { day_closed: false, grats_today: 0, last_session_date: today };
    await supabase.from(table).update(reset).eq('id', id);
    state = { ...state, ...reset };
  } else if (state.last_session_date !== today) {
    await supabase.from(table).update({ last_session_date: today }).eq('id', id);
  }

  // Entries for counts + recent list.
  const sel = supabase.from('entries').select('entry_date, items, day_num').order('entry_date', { ascending: false });
  const { data: rows } = userId ? await sel.eq('user_id', id) : await sel.eq('anon_id', id);
  const entries = rows ?? [];

  const doneToday = state.day_closed && state.last_session_date === today;
  const todayRow = entries.find((e) => e.entry_date === today);
  const monthPrefix = today.slice(0, 7);
  const monthCount = entries.filter((e) => e.entry_date.startsWith(monthPrefix)).length;

  return json({
    day: state.day,
    streak: state.streak,
    doneToday,
    todayItems: todayRow?.items ?? [],
    recent: entries.filter((e) => e.entry_date !== today).slice(0, 5).map((e) => ({ date: e.entry_date, items: e.items })),
    resurfaced: doneToday ? pickResurfaced(entries, today) : null,
    monthCount,
    allTime: entries.length,
    reminder: { enabled: state.notif_enabled ?? false, time: state.reminder_time ?? '8:00 pm' },
    signedIn: !!userId,
  });
};

export const config = { path: '/api/state' };
