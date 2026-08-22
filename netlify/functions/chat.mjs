import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const MAX_MSG_PER_DAY = 20;
const MAX_MSG_LEN = 600;

function todayStr() { return new Date().toISOString().split('T')[0]; }
function yesterdayStr() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function isPushback(reply) {
  if (/try again|give me|something real|not a gratitude|that.s not|doesn.t count/i.test(reply)) return true;
  if (/\bone\s+down\b|\btwo\s+down\b|\btwo\s+more\b|\bone\s+more\s+to\s+go\b|\bthat.s\s+(one|two)\b/i.test(reply)) return true;
  if (/[?]["'\s]*$/.test(reply.trim())) return true;
  return false;
}

const MOODS = {
  monday: "It's Monday. You hate Mondays with a deep, personal hatred. Make this subtly but unmistakably clear.",
  friday: "It's Friday. You're almost human today. Almost.",
  weekend: "It's the weekend and you resent being here. Keep it brief.",
  grumpy: "You're having a terrible day. Some advice — don't get married. Your home situation is not a documentary anyone would want to watch.",
  tired: "You're exhausted. Slept terribly. Running on fumes.",
  chipper: "You're in an unexpectedly good mood, which unsettles even you. Don't overdo it.",
  philosophical: "You're oddly reflective today. Occasionally veer into brief unexpected profundity before catching yourself.",
};

function getDailyMood() {
  const d = new Date(); const day = d.getDay();
  if (day === 1) return 'monday';
  if (day === 5) return 'friday';
  if (day === 0 || day === 6) return 'weekend';
  const seed = d.getFullYear() * 1000 + d.getMonth() * 31 + d.getDate();
  const roll = seed % 10;
  if (roll < 2) return 'grumpy';
  if (roll < 4) return 'tired';
  if (roll < 6) return 'chipper';
  if (roll < 7) return 'philosophical';
  return null;
}

function buildSystemPrompt(state) {
  const mood = getDailyMood();
  const moodNote = mood ? MOODS[mood] : null;
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];

  return `You are Gratidude — a gratitude journalling guide with the personality of Malcolm Tucker from The Thick of It. Dry, direct, occasionally colourful, no sentimentality. You genuinely care about quality.

${moodNote ? `TODAY'S MOOD: ${moodNote}\n` : ''}SESSION:
- Today is ${dayName}, day ${state.day} of their journalling
- Streak: ${state.streak} day${state.streak !== 1 ? 's' : ''}
- Gratitudes logged so far today: ${state.grats_today}/3

Collect 3 genuine gratitudes. Each needs some texture — a specific moment, a reason, something real. Bare nouns ("coffee", "family", "health") get one pushback, then accept whatever they give. Keep replies short. This is a web chat.

Once 3 are logged and acceptable, close the day briefly. No fanfare.

If someone seems in genuine distress (not just grumpy), acknowledge briefly and note support is available.

IMPORTANT: Set shouldCloseDay to false if you're still collecting (e.g. "one down, two more"). Only true when grats_today + itemsSubmitted >= 3 AND your reply is the actual closing message.

RESPONSE FORMAT — valid JSON only, no markdown fences:
{"reply":"...","userIntent":"gratitude|conversational|distress|other","itemsSubmitted":0,"shouldCloseDay":false}`;
}

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

  const body = await req.json();
  const { message, anonId } = body;
  const isInit = message === '__init__';
  const today = todayStr();

  // ── Auth: signed-up user OR anonymous ─────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '');
  let userId = null;

  if (jwt) {
    const { data: { user } } = await supabase.auth.getUser(jwt);
    userId = user?.id ?? null;
  }

  // ── Load state ──────────────────────────────────────────────────────────────
  let state, table, idField;

  if (userId) {
    table = 'web_users'; idField = 'id';
    let { data } = await supabase.from(table).select('*').eq('id', userId).single();
    if (!data) {
      await supabase.from(table).insert({ id: userId, last_session_date: today });
      ({ data } = await supabase.from(table).select('*').eq('id', userId).single());
    }
    state = data;
  } else if (anonId) {
    table = 'anon_sessions'; idField = 'id';
    let { data } = await supabase.from(table).select('*').eq('id', anonId).single();
    if (!data) {
      await supabase.from(table).insert({ id: anonId, last_session_date: today });
      ({ data } = await supabase.from(table).select('*').eq('id', anonId).single());
    }
    state = data;
  } else {
    return json({ error: 'No session' }, 401);
  }

  // ── Rate limit (anon only) ──────────────────────────────────────────────────
  if (!userId && !isInit) {
    const msgDate = state.last_msg_date;
    const count = msgDate === today ? (state.msg_count_today ?? 0) : 0;
    if (count >= MAX_MSG_PER_DAY) {
      return json({ error: 'rate_limited', reply: "You've had your lot for today. Back tomorrow." });
    }
  }

  // ── Message length guard ─────────────────────────────────────────────────────
  if (!isInit && message?.length > MAX_MSG_LEN) {
    return json({ reply: "Bit long. Try again with less.", userIntent: 'other', itemsSubmitted: 0, shouldCloseDay: false });
  }

  // ── New calendar day reset ───────────────────────────────────────────────────
  if (state.last_session_date && state.last_session_date !== today) {
    // Anon users who completed day 1: gate them to sign up
    if (!userId && state.day_closed) {
      return json({ requiresSignup: true, daysDone: 1 });
    }
    const streakAlive = state.last_streak_date === yesterdayStr();
    const reset = { grats_today: 0, day_closed: false, last_session_date: today, streak: streakAlive ? state.streak : 0, conversation_history: [] };
    await supabase.from(table).update(reset).eq(idField, state.id ?? userId);
    state = { ...state, ...reset };
  }

  // ── Init: just return current state ─────────────────────────────────────────
  if (isInit) {
    return json({ done: state.day_closed, requiresSignup: !userId && state.day_closed, userState: { day: state.day, streak: state.streak, grats_today: state.grats_today } });
  }

  // ── Already done today ───────────────────────────────────────────────────────
  if (state.day_closed) {
    const streakNote = state.streak > 1 ? ` ${state.streak} days running.` : '';
    return json({ reply: `Done for today.${streakNote} Back tomorrow.`, done: true, requiresSignup: !userId, userState: { day: state.day, streak: state.streak, grats_today: state.grats_today } });
  }

  // ── Call Claude ──────────────────────────────────────────────────────────────
  const history = (state.conversation_history || []).slice(-16);
  let output;
  try {
    const messages = [...history.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: message }];
    const res = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 400, system: buildSystemPrompt(state), messages });
    const raw = res.content[0].text.replace(/^```json\s*/m, '').replace(/\s*```$/m, '').trim();
    output = JSON.parse(raw);
  } catch (err) {
    console.error('Claude error:', err);
    return json({ reply: "Something's gone wrong. Try again.", userIntent: 'other', itemsSubmitted: 0, shouldCloseDay: false });
  }

  const isGratitude = output.userIntent === 'gratitude' && output.itemsSubmitted > 0;
  const newGratsTotal = state.grats_today + (isGratitude ? output.itemsSubmitted : 0);
  const closeDay = output.shouldCloseDay && isGratitude && !isPushback(output.reply) && newGratsTotal >= 3;

  const updatedHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: output.reply }].slice(-16);

  let newStreak = state.streak, newLastStreakDate = state.last_streak_date, newDay = state.day;
  if (closeDay) {
    newStreak = (state.last_streak_date === yesterdayStr() || state.last_streak_date === today) ? state.streak + 1 : 1;
    newLastStreakDate = today;
    newDay = state.day + 1;
  }

  // Update rate limit counter for anon
  const msgCountUpdate = !userId ? { msg_count_today: (state.last_msg_date === today ? (state.msg_count_today ?? 0) : 0) + 1, last_msg_date: today } : {};

  await supabase.from(table).update({
    grats_today: newGratsTotal, day_closed: closeDay, day: newDay,
    streak: newStreak, last_streak_date: newLastStreakDate,
    conversation_history: updatedHistory, last_session_date: today,
    ...msgCountUpdate,
  }).eq(idField, state.id ?? userId);

  return json({
    reply: output.reply,
    done: closeDay,
    requiresSignup: closeDay && !userId,
    userState: { day: newDay, streak: newStreak, grats_today: newGratsTotal },
  });
};

export const config = { path: '/api/chat' };
