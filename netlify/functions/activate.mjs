// Transfers an anonymous session (state, settings and journal) to a user account.
import { supabase, json, preflight, getUserId } from '../lib/session.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const userId = await getUserId(req);
  if (!userId) return json({ error: 'Unauthorised' }, 401);

  const { anonId } = await req.json();

  const { data: existing } = await supabase.from('web_users').select('id').eq('id', userId).single();

  if (!existing && anonId) {
    const { data: anon } = await supabase
      .from('anon_sessions').select('*').eq('id', anonId).eq('transferred', false).single();

    if (anon) {
      await supabase.from('web_users').insert({
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
      await supabase.from('entries').update({ user_id: userId, anon_id: null }).eq('anon_id', anonId);
      await supabase.from('anon_sessions').update({ transferred: true }).eq('id', anonId);

      return json({ ok: true, transferred: true });
    }
  }

  if (!existing) await supabase.from('web_users').insert({ id: userId });

  return json({ ok: true, transferred: false });
};

export const config = { path: '/api/activate' };
