// Transfers an anonymous session to a newly signed-up user account
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
  });

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!jwt) return json({ error: 'Unauthorised' }, 401);

  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return json({ error: 'Unauthorised' }, 401);

  const { anonId } = await req.json();

  // Check if account already exists (e.g. returning user who signed in again)
  const { data: existing } = await supabase.from('web_users').select('id').eq('id', user.id).single();
  if (existing) return json({ ok: true, transferred: false });

  // Transfer anon state if we have one
  if (anonId) {
    const { data: anon } = await supabase.from('anon_sessions').select('*').eq('id', anonId).eq('transferred', false).single();
    if (anon) {
      await supabase.from('web_users').insert({
        id: user.id,
        day: anon.day,
        grats_today: anon.grats_today,
        day_closed: anon.day_closed,
        last_session_date: anon.last_session_date,
        streak: anon.streak,
        last_streak_date: anon.last_streak_date,
        conversation_history: anon.conversation_history,
      });
      await supabase.from('anon_sessions').update({ transferred: true }).eq('id', anonId);
      return json({ ok: true, transferred: true });
    }
  }

  // No anon state — just create a fresh account
  await supabase.from('web_users').insert({ id: user.id });
  return json({ ok: true, transferred: false });
};

export const config = { path: '/api/activate' };
