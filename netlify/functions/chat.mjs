import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from '../lib/persona.mjs';
import { supabase, todayStr, yesterdayStr, json, preflight, loadSession, publicSettings } from '../lib/session.mjs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_MSG_PER_DAY = 20;
const MAX_MSG_LEN = 600;

/** Guards against Claude closing the day while it is still asking for more. */
function isPushback(reply) {
  if (/try again|give me|something real|not a gratitude|that.s not|doesn.t count/i.test(reply)) return true;
  if (/\bone\s+down\b|\btwo\s+down\b|\btwo\s+more\b|\bone\s+more\s+to\s+go\b|\bthat.s\s+(one|two)\b/i.test(reply)) return true;
  if (/[?]["'\s]*$/.test(reply.trim())) return true;
  return false;
}

const stripDashes = (s) => (typeof s === 'string' ? s.replace(/\s*[—–]\s*/g, ' - ') : s);

export default async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  const { message, anonId } = await req.json();
  const isInit = message === '__init__';
  const today = todayStr();

  const session = await loadSession(req, anonId);
  if (!session) return json({ error: 'No session' }, 401);

  let { state, table, id, userId } = session;

  // ── Rate limit (anonymous only) ────────────────────────────────────────────
  if (!userId && !isInit) {
    const count = state.last_msg_date === today ? (state.msg_count_today ?? 0) : 0;
    if (count >= MAX_MSG_PER_DAY) {
      return json({ error: 'rate_limited', reply: "You've had your lot for today. Back tomorrow." });
    }
  }

  if (!isInit && message?.length > MAX_MSG_LEN) {
    return json({ reply: 'Bit long. Try again with less.', userIntent: 'other', itemsSubmitted: 0, shouldCloseDay: false });
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

  if (isInit) {
    return json({
      done: state.day_closed,
      requiresSignup: !userId && state.day_closed,
      settings,
      userState: { day: state.day, streak: state.streak, grats_today: state.grats_today },
    });
  }

  if (state.day_closed) {
    const streakNote = state.streak > 1 ? ` ${state.streak} days running.` : '';
    return json({
      reply: `Done for today.${streakNote} Back tomorrow.`,
      done: true,
      requiresSignup: !userId,
      settings,
      userState: { day: state.day, streak: state.streak, grats_today: state.grats_today },
    });
  }

  // ── Claude ─────────────────────────────────────────────────────────────────
  const history = (state.conversation_history || []).slice(-16);
  let output;
  try {
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: buildSystemPrompt(state),
      messages,
    });
    const raw = res.content[0].text.replace(/^```json\s*/m, '').replace(/\s*```$/m, '').trim();
    output = JSON.parse(raw);
  } catch (err) {
    console.error('Claude error:', err);
    return json({ reply: "Something's gone wrong. Try again.", userIntent: 'other', itemsSubmitted: 0, shouldCloseDay: false });
  }

  output.reply = stripDashes(output.reply);

  const isGratitude = output.userIntent === 'gratitude' && output.itemsSubmitted > 0;
  const newGratsTotal = state.grats_today + (isGratitude ? output.itemsSubmitted : 0);
  const closeDay = output.shouldCloseDay && isGratitude && !isPushback(output.reply) && newGratsTotal >= 3;

  const updatedHistory = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: output.reply },
  ].slice(-16);

  let newStreak = state.streak;
  let newLastStreakDate = state.last_streak_date;
  let newDay = state.day;

  if (closeDay) {
    newStreak = (state.last_streak_date === yesterdayStr() || state.last_streak_date === today) ? state.streak + 1 : 1;
    newLastStreakDate = today;
    newDay = state.day + 1;

    // Save the day's three gratitudes to the journal.
    const items = (Array.isArray(output.items) ? output.items : []).map(stripDashes).filter(Boolean).slice(0, 3);
    if (items.length) {
      const owner = userId ? { user_id: userId } : { anon_id: id };
      // Partial unique indexes make ON CONFLICT awkward, so clear then insert.
      await supabase.from('entries').delete().match({ ...owner, entry_date: today });
      await supabase.from('entries').insert({ ...owner, entry_date: today, items, day_num: state.day });
    }
  }

  const msgCountUpdate = !userId
    ? {
        msg_count_today: (state.last_msg_date === today ? (state.msg_count_today ?? 0) : 0) + 1,
        last_msg_date: today,
      }
    : {};

  await supabase.from(table).update({
    grats_today: newGratsTotal,
    day_closed: closeDay,
    day: newDay,
    streak: newStreak,
    last_streak_date: newLastStreakDate,
    conversation_history: updatedHistory,
    last_session_date: today,
    ...msgCountUpdate,
  }).eq('id', id);

  return json({
    reply: output.reply,
    done: closeDay,
    requiresSignup: closeDay && !userId,
    settings,
    userState: { day: newDay, streak: newStreak, grats_today: newGratsTotal },
  });
};

export const config = { path: '/api/chat' };
