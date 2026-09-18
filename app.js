/* global supabase */

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://ykaddcnbokbmwoyvurlr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYWRkY25ib2tibXdveXZ1cmxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTM0MDksImV4cCI6MjA5MjY4OTQwOX0.bzVSEswEGYpp8tXQQ5gpH_fdI3Rk5pWHqm9F5ALXIp0';

const CAME_FROM_MAGIC_LINK = /[#&?](access_token|code)=/.test(window.location.hash + window.location.search);
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ───────────────────────────────────────────────────────────────────
let authSession = null;
let anonId = null;
let editing = false;
let current = { day: 1, streak: 0, doneToday: false, reminder: { enabled: false, time: '8:00 pm' } };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const REMINDER_PRESETS = ['7:00 am', '12:00 pm', '6:00 pm', '8:00 pm', '9:30 pm'];

function getOrCreateAnonId() {
  let id = localStorage.getItem('gratidude_anon_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('gratidude_anon_id', id); }
  return id;
}

async function api(path, body = {}, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const payload = { ...body };
  if (authSession) headers.Authorization = `Bearer ${authSession.access_token}`;
  else payload.anonId = anonId;
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), signal: opts.signal });
  if (!res.ok) { const e = new Error(path); e.status = res.status; e.body = await res.json().catch(() => ({})); throw e; }
  return res.json();
}

// ── Screen routing + menu ───────────────────────────────────────────────────
const SCREENS = ['home', 'journal', 'habit', 'about', 'login'];

function show(name) {
  if (name !== 'home') editing = false;
  SCREENS.forEach((s) => $(s).classList.toggle('on', s === name));
  window.scrollTo(0, 0);
  if (name === 'home') { paintHome(); if (!current.doneToday || editing) $('g1').focus(); }
  if (name === 'journal') loadJournal();
  if (name === 'habit') paintReminder();
  if (name === 'login') paintLogin();
}

function toggleMenu(force) {
  $('menu').classList.toggle('on', force === undefined ? undefined : force);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-menu]')) { e.preventDefault(); toggleMenu(); return; }
  const c = e.target.closest('[data-contact]');
  if (c) { e.preventDefault(); toggleMenu(false); openContact(c.dataset.contact); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed) { e.preventDefault(); startEdit(); return; }
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); toggleMenu(false); show(go.dataset.go); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('contact-modal').hidden) closeContact();
  else if ($('menu').classList.contains('on')) toggleMenu(false);
});

// ── The command headline (writing state) ─────────────────────────────────────
// Fixed default for now — more variants can come back once the copy is final.
const WRITING_CMD = ['Give me three things you’re grateful for,', 'then bugger off.'];
const writingCommandHTML = () => `${esc(WRITING_CMD[0])} <span class="dim">${esc(WRITING_CMD[1])}</span>`;

// ── Rotating placeholders (a fresh three each visit) ────────────────────────
const PLACEHOLDER_POOL = [
  'My sports team not playing terribly', 'Having a beer with my friends', 'Lying in bed and watching TV',
  'The bus turning up on time', 'Nobody sitting next to me on the train', 'A cup of tea at the right strength',
  'Getting the good parking spot', 'My knees not hurting today', 'A biscuit that survived the dunk',
  'The wifi actually working', 'Leftovers for lunch', 'Rain while I was already indoors',
  'The dog being pleased to see me', 'A meeting that got cancelled', 'Someone else making the coffee',
  'Clean sheets night', 'Toast, correctly browned', 'Payday landing a day early',
  'A shower with decent water pressure', 'The kettle boiling before I got back',
  'My team not conceding in the last minute', 'Getting a seat at the pub', 'Nobody replying to that email yet',
  'The bin men coming on the right day',
];
function setPlaceholders() {
  const picks = [...PLACEHOLDER_POOL].sort(() => Math.random() - 0.5).slice(0, 3);
  gs().forEach((el, i) => { el.placeholder = picks[i]; });
}

// ── Home (writing / editing / done) ─────────────────────────────────────────
const gs = () => [$('g1'), $('g2'), $('g3')];
const filled = () => gs().every((i) => i.value.trim());

function paintHome() {
  const done = !!current.doneToday && !editing;

  $('logged-stamp').hidden = !done;
  $('form').hidden = done;
  $('write-actions').hidden = done;
  $('privacy-micro').hidden = done;
  $('done-fields').hidden = !done;
  $('done-actions').hidden = !done;
  $('save-nudge').hidden = !(done && !authSession);

  if (done) {
    $('done-fields').innerHTML = (current.todayItems ?? []).map((t, i) =>
      `<div class="row"><span class="n">0${i + 1}</span><p class="read">${esc(t)}</p></div>`).join('');
    handleNote(); // sets #cmd to the day's verdict
    return;
  }

  if (editing) {
    $('cmd').innerHTML = 'Changed your mind. <span class="dim">Get on with it.</span>';
    gs().forEach((i, n) => { i.value = current.todayItems?.[n] ?? ''; i.closest('.row').classList.toggle('filled', !!i.value.trim()); });
    $('submit').textContent = 'Save changes';
  } else {
    $('cmd').innerHTML = writingCommandHTML();
    gs().forEach((i) => { i.value = ''; i.closest('.row').classList.remove('filled'); });
    setPlaceholders();
    $('submit').textContent = 'Submit';
  }
  $('submit').disabled = !filled();
}

function startEdit() { editing = true; show('home'); }

$('form').addEventListener('input', (e) => {
  const row = e.target.closest('.row');
  if (row) row.classList.toggle('filled', !!e.target.value.trim());
  $('submit').disabled = !filled();
});
gs().forEach((el, i) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { if (!$('submit').disabled) $('submit').click(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (i < 2) gs()[i + 1].focus(); else if (!$('submit').disabled) $('submit').click(); }
  });
});

$('submit').addEventListener('click', async () => {
  if (!filled()) return;
  const items = gs().map((i) => i.value.trim());
  $('submit').disabled = true;
  try {
    const data = await api('/api/submit', { items });
    current = { ...current, ...data };
  } catch {
    current = { ...current, doneToday: true, todayItems: items, todayDayNum: current.todayDayNum ?? current.day, noteReady: false, todayNote: null };
  }
  editing = false;
  journalCache = null;
  show('home');
});

// ── The day's verdict (the sarcastic pay-off in the command slot) ───────────
const SUBQUIPS = [
  "Slow clap. You'll be a Zen master in no time.",
  "Namaste. You're really doing it.",
  "Good boy. Pat on the head.",
  "Three whole things. Extraordinary scenes.",
  "Look at you, feeling things on purpose.",
  "That's the bare minimum and you cleared it. Proud, sort of.",
  "Gratitude logged. Don't let it go to your head.",
  "Marvellous. Now go and be insufferable about it.",
  "Three things. Practically a monk now.",
  "Enlightenment pending. Back tomorrow.",
  "Cracking effort. The universe is thrilled, apparently.",
  "There it is. Character development.",
  "Big day for your spiritual growth. Enormous.",
  "Done. You're basically the Dalai Lama with wifi.",
];
const pickQuip = (dayNum) => SUBQUIPS[(Number.isFinite(dayNum) && dayNum > 0 ? dayNum : 1) % SUBQUIPS.length];

function showQuote(text, fade) {
  if (!text) return;
  $('cmd').textContent = text;
  if (fade) { $('cmd').style.opacity = '0'; requestAnimationFrame(() => { $('cmd').style.transition = 'opacity .2s linear'; $('cmd').style.opacity = '1'; }); }
}

// Days 1-3: guaranteed stock verdict. Day 4+: the drill instructor reads your
// three and takes the piss; a safety pass drops the act on anything heavy.
async function handleNote() {
  const dayNum = current.todayDayNum ?? current.day;
  showQuote(pickQuip(dayNum), true);
  if (dayNum <= 3) return;
  if (current.noteReady) { if (current.todayNote) showQuote(current.todayNote, false); return; }

  const fetchNote = async (timeout) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try { const data = await api('/api/note', {}, { signal: ctrl.signal }); return data.note ?? null; }
    finally { clearTimeout(timer); }
  };
  try {
    const note = await fetchNote(10000);
    current.noteReady = true; current.todayNote = note;
    if (note) showQuote(note, true);
  } catch {
    try { await delay(1500); const note = await fetchNote(6000); current.noteReady = true; current.todayNote = note; if (note) showQuote(note, true); }
    catch { /* keep the stock verdict */ }
  }
}

// ── Journal ─────────────────────────────────────────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
}
let journalCache = null;

function renderJournal(data) {
  const total = data.stats.allTime ?? 0;
  const streak = data.stats.streak ?? 0;
  const bits = [];
  if (total) bits.push(`${total} ${total === 1 ? 'entry' : 'entries'}`);
  if (streak > 0) bits.push(`${streak}-day streak`);
  $('j-summary').textContent = bits.join('  ·  ');
  $('j-summary').hidden = bits.length === 0;

  const list = $('j-list');
  const todayIso = new Date().toISOString().slice(0, 10);
  if (!data.entries.length) { list.innerHTML = ''; $('j-empty').hidden = false; return; }
  $('j-empty').hidden = true;

  let html = '';
  let lastMonth = '';
  for (const e of data.entries) {
    const [y, m] = e.date.split('-').map(Number);
    const label = `${MONTHS[m - 1]} ${y}`;
    if (label !== lastMonth) { html += `<p class="mlabel">${label}</p>`; lastMonth = label; }
    const isToday = e.date === todayIso;
    const dateLine = isToday ? `Today <span class="dsub">${fmtDay(e.date)}</span>` : fmtDay(e.date);
    html += `<div class="entry${isToday ? ' is-today' : ''}"><div class="ehd"><span class="d">${dateLine}</span></div>`
      + (e.items || []).map((g, i) => `<div class="jg n${i + 1}"><span class="n">0${i + 1}</span><span class="t">${esc(g)}</span></div>`).join('')
      + `</div>`;
  }
  list.innerHTML = html;
}

async function loadJournal() {
  if (journalCache) { renderJournal(journalCache); }
  else { $('j-list').innerHTML = ''; $('j-summary').hidden = true; $('j-empty').hidden = true; $('j-loading').hidden = false; }
  let data;
  try { data = await api('/api/journal'); }
  catch { data = journalCache ?? { entries: [], stats: { streak: current.streak, thisMonth: 0, allTime: 0 } }; }
  journalCache = data;
  $('j-loading').hidden = true;
  renderJournal(data);
}

// ── Build the habit: reminders ──────────────────────────────────────────────
function paintReminder() {
  const { enabled, time } = current.reminder;
  $('rem-sw').setAttribute('aria-checked', enabled);
  const isCustom = !REMINDER_PRESETS.includes(time);
  const chips = [...REMINDER_PRESETS, 'Custom'];
  $('rem-times').innerHTML = chips.map((t) => {
    const on = t === 'Custom' ? isCustom : t === time;
    return `<button class="time${on ? ' on' : ''}" type="button" data-rem="${t}">${t}</button>`;
  }).join('');
  $('rem-times').classList.toggle('off', !enabled);
  const custom = $('rem-custom');
  custom.hidden = !isCustom;
  custom.classList.toggle('off', !enabled);
  if (isCustom) $('rem-ct').value = /^\d{2}:\d{2}$/.test(time) ? time : '20:00';
}
async function saveReminder(patch) {
  current.reminder = { ...current.reminder, ...patch };
  paintReminder();
  try { const d = await api('/api/settings', current.reminder); if (d.reminder) current.reminder = d.reminder; }
  catch { /* keep optimistic value */ }
}
function requestNotifyThenTrue() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  return true;
}
$('rem-sw').addEventListener('click', () => saveReminder({ enabled: current.reminder.enabled ? false : requestNotifyThenTrue() }));
$('rem-times').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rem]');
  if (!b) return;
  if (b.dataset.rem === 'Custom') { saveReminder({ time: $('rem-ct').value || '20:00' }); setTimeout(() => $('rem-ct').focus(), 0); }
  else saveReminder({ time: b.dataset.rem });
});
$('rem-ct').addEventListener('change', () => saveReminder({ time: $('rem-ct').value }));

// ── About: contact ──────────────────────────────────────────────────────────
$('contact').addEventListener('submit', async () => {
  const msg = $('c-msg').value.trim();
  const email = $('c-email').value.trim();
  if (!msg) return;
  $('c-send').disabled = true;
  try {
    await api('/api/feedback', { email, message: msg, type: 'general' });
    $('c-msg').value = ''; $('c-email').value = '';
    const ok = $('c-ok'); ok.textContent = 'Got it. Now sod off and have a day.'; ok.hidden = false;
  } catch {
    const ok = $('c-ok'); ok.textContent = "Didn't send — email hello@gratidude.ai instead."; ok.hidden = false;
  }
  $('c-send').disabled = false;
});

// ── Contact / bug modal ─────────────────────────────────────────────────────
function openContact(type) {
  const bug = type === 'bug';
  $('contact-title').textContent = bug ? 'Report a bug.' : 'Get in touch.';
  $('contact-sub').textContent = bug ? 'What broke? Spare no detail.' : 'Something to say? Make it brief.';
  $('cm-send').textContent = 'Send it'; $('cm-send').disabled = false;
  $('cm-ok').hidden = true; $('cm-ok').textContent = '';
  $('contact-modal').dataset.type = type;
  $('contact-modal').hidden = false;
  $('cm-email').focus();
}
function closeContact() { $('contact-modal').hidden = true; }
$('contact-close').addEventListener('click', closeContact);
$('contact-modal').addEventListener('click', (e) => { if (e.target === $('contact-modal')) closeContact(); });
$('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = $('cm-msg').value.trim();
  if (!message) { $('cm-msg').focus(); return; }
  $('cm-send').disabled = true; $('cm-send').textContent = 'Sending…';
  try {
    await api('/api/feedback', { email: $('cm-email').value.trim(), message, type: $('contact-modal').dataset.type });
    $('cm-ok').textContent = 'Got it. Now sod off and have a day.'; $('cm-ok').hidden = false;
    $('cm-msg').value = '';
    setTimeout(closeContact, 1600);
  } catch {
    $('cm-ok').textContent = "Didn't send. Email hello@gratidude.ai instead.";
    $('cm-ok').hidden = false;
    $('cm-send').disabled = false; $('cm-send').textContent = 'Send it';
  }
});

// ── Account / sign in ───────────────────────────────────────────────────────
function paintLogin() {
  const signedIn = !!authSession;
  $('login-card').hidden = signedIn;
  $('login-sent').hidden = true;
  $('login-in').hidden = !signedIn;
  if (signedIn) {
    $('account-email').textContent = authSession.user?.email ?? '';
    $('login-in-head').textContent = 'Your account.';
  }
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
$('email').addEventListener('input', () => {
  $('signin-btn').disabled = !EMAIL_RE.test($('email').value.trim());
  $('login-error').textContent = '';
});
$('signin-btn').disabled = true;
$('signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  if (!EMAIL_RE.test(email)) { $('login-error').textContent = 'that email looks off'; return; }
  const btn = $('signin-btn');
  btn.disabled = true; btn.textContent = 'Sending…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) { $('login-error').textContent = "didn't send. try again."; btn.disabled = false; btn.textContent = 'Send me a link'; return; }
  $('sent-to').textContent = email;
  $('login-card').hidden = true;
  $('login-sent').hidden = false;
});
$('signout-btn')?.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

// ── Rotating tagline word (your pool, fade swap) ────────────────────────────
const WHO = ['dudes', 'blokes', 'straight-talkers', 'yoga-haters', 'bad bitches', 'rationalists', 'cynics', 'overthinkers', 'sceptics', 'pessimists', 'doom-scrollers'];
(function taglineRotor() {
  const el = $('who');
  let wi = Math.floor(Math.random() * WHO.length);
  el.textContent = `${WHO[wi]}.`;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setInterval(() => {
    wi = (wi + 1) % WHO.length;
    el.classList.add('out');
    setTimeout(() => { el.textContent = `${WHO[wi]}.`; el.classList.remove('out'); }, 200);
  }, 2600);
})();

// ── Auth transfer + boot ────────────────────────────────────────────────────
async function activate(session) {
  try {
    await fetch('/api/activate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ anonId }) });
  } catch { /* non-fatal */ }
  history.replaceState(null, '', window.location.pathname);
}

sb.auth.onAuthStateChange(async (event, session) => {
  if (event !== 'SIGNED_IN' || !session) return;
  if (authSession?.access_token === session.access_token) return;
  authSession = session;
  await activate(session);
  try { const st = await api('/api/state'); current = { ...current, ...st }; } catch { /* non-fatal */ }
  show('login');
  $('login-in-head').textContent = "You're in.";
});

async function boot() {
  let state = null;
  try { state = await api('/api/state'); } catch { /* fresh, offline, or brand new */ }
  if (state) current = { ...current, ...state };
  paintReminder();
  show('home');
}

async function init() {
  // Paint the home screen instantly with defaults so the headline and fields
  // never wait on a network round-trip; boot() repaints once real state lands.
  show('home');

  anonId = getOrCreateAnonId();
  const { data: { session } } = await sb.auth.getSession();
  if (session) { authSession = session; await activate(session); }

  if (CAME_FROM_MAGIC_LINK && authSession) {
    history.replaceState(null, '', window.location.pathname);
    try { const st = await api('/api/state'); current = { ...current, ...st }; } catch { /* non-fatal */ }
    show('login');
    $('login-in-head').textContent = "You're in.";
    return;
  }
  await boot();
}

init();
