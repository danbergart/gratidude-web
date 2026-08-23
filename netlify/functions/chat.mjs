import Anthropic from '@anthropic-ai/sdk';
import { buildAckPrompt } from '../lib/persona.mjs';
import { supabase, todayStr, yesterdayStr, json, preflight, loadSession, publicSettings } from '../lib/session.mjs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_SUBMITS_PER_DAY = 20;
const MAX_ITEM_LEN = 200;

const stripDashes = (s) => (typeof s === 'string' ? s.replace(/\s*[—–]\s*/g, ' - ') : s);

const clean = (items) => (Array.isArray(items) ? items : [])
  .map((t) => stripDashes(String(t ?? '').trim()).slice(0, MAX_ITEM_LEN))
  .filter(Boolean)
  .slice(0, 3);

/** One line back in character. Never blocks the save - the day is closed either way. */
async function acknowledge(state, items) {
  try {
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: buildAckPrompt(state, items),
      messages: [{ role: 'user', content: items.map((t, i) => `${i + 1}. ${t}`).join('\n') }],
    });
    return stripDashes(res.content[0].text.trim());
  } catch (err) {
    console.error('Claude error:', err);
    return 'Logged. Same again tomorrow.';
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const { message, items, anonId } = await req.json();
  const isInit = message === '__init__';
  const today = todayStr();

  const session = await loadSession(req, anonId);
  if (!session) return json({ error: 'No session' }, 401);

  let { state, table, id, userId } = session;

  // ── Rate limit (anonymous only) ────────────────────────────────────────────
  if (!userId && !isInit) {
    const count = state.last_msg_date === today ? (state.msg_count_today ?? 0) : 0;
    if (count >= MAX_SUBMITS_PER_DAY) {
      return json({ error: 'rate_limited', reply: "You've had your lot for today. Back tomorrow." });
    }
  }

  // ── New calendar day reset ─────────────────────────────────────────────────
  if (state.last_session_date && state.last_session_date !== today) {
    // Anonymous users get one free day, then must sign up.
    if (!userId && state.day_closed) {
      return json({ requiresSignup: true, daysDone: 1, settings: publicSettings(state) });
    }
    const streakAlive = state.last_streak_date === yesterdayStr();
    const reset = {
      grats_today: 0,
      day_closed: false,
      last_session_date: today,
      streak: streakAlive ? state.streak : 0,
      conversation_history: [],
    };
    await supabase.from(table).update(reset).eq('id', id);
    state = { ...state, ...reset };
  }

  const settings = publicSettings(state);
  const userState = () => ({ day: state.day, streak: state.streak, grats_today: state.grats_today });

  if (isInit) {
    return json({
      done: state.day_closed,
      requiresSignup: !userId && state.day_closed,
      settings,
      userState: userState(),
    });
  }

  if (state.day_closed) {
    const streakNote = state.streak > 1 ? ` ${state.streak} days running.` : '';
    return json({
      reply: `Done for today.${streakNote} Back tomorrow.`,
      done: true,
      requiresSignup: !userId,
      settings,
      userState: userState(),
    });
  }

  // ── Three things in, day closed ────────────────────────────────────────────
  const entries = clean(items);
  if (!entries.length) {
    return json({ error: 'empty', reply: 'nothing there. three things.', settings, userState: userState() });
  }

  const streak = (state.last_streak_date === yesterdayStr() || state.last_streak_date === today)
    ? state.streak + 1
    : 1;
  const day = state.day + 1;

  // Their own words, saved as written. Nothing rewrites or grades them.
  const owner = userId ? { user_id: userId } : { anon_id: id };
  // Partial unique indexes make ON CONFLICT awkward, so clear then insert.
  await supabase.from('entries').delete().match({ ...owner, entry_date: today });
  await supabase.from('entries').insert({ ...owner, entry_date: today, items: entries, day_num: state.day });

  const reply = await acknowledge(state, entries);

  const msgCountUpdate = !userId
    ? {
        msg_count_today: (state.last_msg_date === today ? (state.msg_count_today ?? 0) : 0) + 1,
        last_msg_date: today,
      }
    : {};

  await supabase.from(table).update({
    grats_today: entries.length,
    day_closed: true,
    day,
    streak,
    last_streak_date: today,
    conversation_history: [
      { role: 'user', content: entries.map((t, i) => `${i + 1}. ${t}`).join('\n') },
      { role: 'assistant', content: reply },
    ],
    last_session_date: today,
    ...msgCountUpdate,
  }).eq('id', id);

  return json({
    reply,
    done: true,
    requiresSignup: !userId,
    settings,
    userState: { day, streak, grats_today: entries.length },
  });
};

export const config = { path: '/api/chat' };
