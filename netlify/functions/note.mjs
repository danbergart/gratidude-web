// One dry AI line reacting to the day's three entries. Generated once per
// day, stored with the entry, never regenerated. Fails silent - an empty
// margin is always an acceptable, finished screen.
import Anthropic from '@anthropic-ai/sdk';
import { supabase, todayStr, json, preflight, loadSession } from '../lib/session.mjs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are Gratidude, a gratitude journal with a dry British sense of humour. A user has just logged three things they're grateful for. Write ONE short sentence - under 18 words - reacting to what they actually wrote. Reference at least one specific thing from their list. Be deadpan and lightly teasing, never encouraging, never sincere-sounding, never offer advice or ask a question. British spelling. No emoji, no exclamation marks, no em-dashes.

First judge the tone of the entries. If any of them touch on grief, illness, mental health, addiction, loss, self-harm, or serious hardship, do not joke: reply with one plain, quiet sentence of acknowledgement, or reply with the single word NONE. If you are unsure, reply NONE.

Reply with the sentence only, or NONE.`;

function validate(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^["“”'']+|["“”'']+$/g, '').trim();
  if (!t || t.toUpperCase() === 'NONE') return null;
  if (/\n/.test(t)) return null;
  if (/!/.test(t)) return null;
  if (/\?\s*$/.test(t)) return null;
  if (/\p{Extended_Pictographic}/u.test(t)) return null;
  if (t.split(/\s+/).length > 22) return null;
  return t.replace(/\s*[—–]\s*/g, ' - ');
}

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const { anonId } = await req.json().catch(() => ({}));
  const session = await loadSession(req, anonId);
  if (!session) return json({ error: 'No session' }, 401);

  const { id, userId } = session;
  const today = todayStr();
  const owner = userId ? { user_id: id } : { anon_id: id };

  const { data: entry } = await supabase
    .from('entries').select('items, note, note_generated').match({ ...owner, entry_date: today }).single();
  if (!entry) return json({ note: null });
  if (entry.note_generated) return json({ note: entry.note ?? null });

  const items = (entry.items || []).slice(0, 3);
  let line = null;
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 60,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Entries: 1. ${items[0] ?? ''} 2. ${items[1] ?? ''} 3. ${items[2] ?? ''}` }],
    });
    line = validate(res.content?.[0]?.text ?? '');
  } catch (err) {
    console.error('note error:', err);
    line = null;
  }

  // Mark generated whatever the outcome, so we never call the model twice for a day.
  await supabase.from('entries').update({ note: line, note_generated: true }).match({ ...owner, entry_date: today });
  return json({ note: line });
};

export const config = { path: '/api/note' };
