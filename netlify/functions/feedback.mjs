import { supabase, json, preflight, loadSession } from '../lib/session.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Fire the message to hello@gratidude.ai via Resend (best-effort). Needs
// RESEND_API_KEY in the environment; without it we just store to the DB.
async function emailToInbox({ kind, replyTo, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const subject = kind === 'bug' ? 'Gratidude — bug report' : 'Gratidude — contact';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Gratidude <hello@gratidude.ai>',
        to: ['hello@gratidude.ai'],
        reply_to: replyTo || undefined,
        subject,
        html: `<p><b>${kind === 'bug' ? 'Bug report' : 'Contact'}</b></p>`
          + `<p>From: ${esc(replyTo) || 'anonymous'}</p>`
          + `<p style="white-space:pre-wrap">${esc(text)}</p>`,
      }),
    });
    return res.ok;
  } catch { return false; }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const { anonId, message, email, type } = await req.json();
  const text = typeof message === 'string' ? message.trim().slice(0, 2000) : '';
  if (!text) return json({ error: 'Empty' }, 400);

  const replyTo = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim() : '';
  const kind = type === 'bug' ? 'bug' : 'general';

  const session = await loadSession(req, anonId);
  const userId = session?.userId ?? null;

  await supabase.from('web_feedback').insert({
    user_id: userId,
    anon_id: userId ? null : (session?.id ?? null),
    message: `[${kind}]${replyTo ? ` <${replyTo}>` : ''} ${text}`,
  });

  await emailToInbox({ kind, replyTo, text });

  return json({ ok: true });
};

export const config = { path: '/api/feedback' };
