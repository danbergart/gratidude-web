// Transfers an anonymous session (state, settings and journal) to a user account.
import { supabase, json, preflight, getUserId } from '../lib/session.mjs';
import { ping } from '../lib/notify.mjs';

export default async (req, context) => {
  if (req.method === 'OPTIONS') return preflight();

  const userId = await getUserId(req);
  if (!userId) return json({ error: 'Unauthorised' }, 401);

  const { anonId } = await req.json();

  const { data: existing } = await supabase.from('web_users').select('id').eq('id', userId).single();

  if (!existing && anonId) {
    const { data: anon } = await supabase
      .from('anon_sessions').select('*').eq('id', anonId).eq('transferred', false).single();

    if (anon) {
      const { error: insertErr } = await supabase.from('web_users').insert({
        id: userId,
        day: anon.day,
        grats_today: anon.grats_today,
        day_closed: anon.day_closed,
        last_session_date: anon.last_session_date,
        streak: anon.streak,
        last_streak_date: anon.last_streak_date,
        conversation_history: anon.conversation_history,
        personality: anon.personality,
        level: anon.level,
        team: anon.team,
        display_name: anon.display_name,
        sounds: anon.sounds,
        notif_enabled: anon.notif_enabled,
        reminder_time: anon.reminder_time,
        onboarded: anon.onboarded,
      });

      // Move the journal across, then retire the anonymous row.
      const { count: carried } = await supabase.from('entries').select('id', { count: 'exact', head: true }).eq('anon_id', anonId);
      await supabase.from('entries').update({ user_id: userId, anon_id: null }).eq('anon_id', anonId);
      await supabase.from('anon_sessions').update({ transferred: true }).eq('id', anonId);

      // Only the call that actually created the account pings (activate can race with itself on sign-in).
      if (!insertErr) ping(context, `New account. They brought ${carried ?? 0} day${carried === 1 ? '' : 's'} of entries with them.`);
      return json({ ok: true, transferred: true });
    }
  }

  if (!existing) {
    const { error: insertErr } = await supabase.from('web_users').insert({ id: userId });
    if (!insertErr) ping(context, 'New account (signed up before writing anything).');
  }

  return json({ ok: true, transferred: false });
};

export const config = { path: '/api/activate' };
