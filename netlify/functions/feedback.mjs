import { supabase, json, preflight, loadSession } from '../lib/session.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const { anonId, message } = await req.json();
  const text = typeof message === 'string' ? message.trim().slice(0, 2000) : '';
  if (!text) return json({ error: 'Empty' }, 400);

  const session = await loadSession(req, anonId);
  const userId = session?.userId ?? null;

  await supabase.from('web_feedback').insert({
    user_id: userId,
    anon_id: userId ? null : (session?.id ?? null),
    message: text,
  });

  return json({ ok: true });
};

export const config = { path: '/api/feedback' };
