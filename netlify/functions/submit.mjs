// Save today's three gratitudes. No AI, no character - just store and advance.
import { supabase, todayStr, yesterdayStr, json, preflight, loadSession } from '../lib/session.mjs';

const MAX_ITEM_LEN = 280;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LEN);

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const { anonId, items } = await req.json();
  const session = await loadSession(req, anonId);
  if (!session) return json({ error: 'No session' }, 401);

  let { state, table, id, userId } = session;
  const today = todayStr();

  // Roll over if the stored "done" flag belongs to an earlier day.
  if (state.last_session_date !== today && state.day_closed) {
    state = { ...state, day_closed: false, grats_today: 0 };
  }

  if (state.day_closed) {
    // Already logged today - return current state, don't double-count.
    const { data: existing } = await (userId
      ? supabase.from('entries').select('items').eq('user_id', id).eq('entry_date', today).single()
      : supabase.from('entries').select('items').eq('anon_id', id).eq('entry_date', today).single());
    return json({ day: state.day, streak: state.streak, doneToday: true, todayItems: existing?.items ?? [] });
  }

  const three = (Array.isArray(items) ? items : []).map(clean).filter(Boolean).slice(0, 3);
  if (three.length < 3) return json({ error: 'need_three' }, 400);

  const streakAlive = state.last_streak_date === yesterdayStr() || state.last_streak_date === today;
  const newStreak = streakAlive ? (state.streak || 0) + 1 : 1;
  const dayNum = state.day;

  const owner = userId ? { user_id: id } : { anon_id: id };
  await supabase.from('entries').delete().match({ ...owner, entry_date: today });
  await supabase.from('entries').insert({ ...owner, entry_date: today, items: three, day_num: dayNum });

  await supabase.from(table).update({
    day: dayNum + 1,
    grats_today: 3,
    day_closed: true,
    streak: newStreak,
    last_streak_date: today,
    last_session_date: today,
  }).eq('id', id);

  return json({ day: dayNum, streak: newStreak, doneToday: true, todayItems: three });
};

export const config = { path: '/api/submit' };
