/* global supabase */

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://ykaddcnbokbmwoyvurlr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYWRkY25ib2tibXdveXZ1cmxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTM0MDksImV4cCI6MjA5MjY4OTQwOX0.bzVSEswEGYpp8tXQQ5gpH_fdI3Rk5pWHqm9F5ALXIp0';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ───────────────────────────────────────────────────────────────────
let authSession = null;
let anonId = null;
let current = { day: 1, streak: 0, doneToday: false, reminder: { enabled: false, time: '8:00 pm' } };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const REMINDER_PRESETS = ['7:00 am', '12:00 pm', '6:00 pm', '8:00 pm', '9:30 pm'];

// ── Anon id ─────────────────────────────────────────────────────────────────
function getOrCreateAnonId() {
  let id = localStorage.getItem('gratidude_anon_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('gratidude_anon_id', id); }
  return id;
}

// ── API ─────────────────────────────────────────────────────────────────────
async function api(path, body = {}, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const payload = { ...body };
  if (authSession) headers.Authorization = `Bearer ${authSession.access_token}`;
  else payload.anonId = anonId;
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), signal: opts.signal });
  if (!res.ok) { const e = new Error(path); e.status = res.status; e.body = await res.json().catch(() => ({})); throw e; }
  return res.json();
}

// ── Icon nav ────────────────────────────────────────────────────────────────
const ICONS = {
  journal: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.6" y="3.1" width="14.8" height="13.3"/><path d="M1.6 6.7h14.8M5.6 1.5v3.2M12.4 1.5v3.2"/></svg>',
  about:   '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="9" cy="9" r="7.4"/><path d="M9 7.9v4.8M9 5.2v1.1"/></svg>',
  account: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="9" cy="6.4" r="3.1"/><path d="M2.9 16.4c0-3.4 2.7-5.2 6.1-5.2s6.1 1.8 6.1 5.2"/></svg>',
};

function paintNav() {
  document.querySelectorAll('.navslot').forEach((slot) => {
    const here = slot.dataset.here;
    slot.innerHTML = ['journal', 'about', 'account'].map((k) => {
      const dest = k === 'account' ? 'login' : k;
      return `<button class="ico${here === k ? ' on' : ''}" type="button" data-go="${dest}" aria-label="${k === 'account' ? 'Account' : k[0].toUpperCase() + k.slice(1)}">${ICONS[k]}</button>`;
    }).join('');
  });
}

// ── Screen routing ──────────────────────────────────────────────────────────
const SCREENS = ['home', 'done', 'journal', 'about', 'login'];

function show(name) {
  SCREENS.forEach((s) => $(s).classList.toggle('on', s === name));
  window.scrollTo(0, 0);
  if (name === 'home') { resetHome(); $('g1').focus(); }
  if (name === 'journal') loadJournal();
}

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); show(go.dataset.go); }
});

// ── Home ────────────────────────────────────────────────────────────────────
const gs = () => [$('g1'), $('g2'), $('g3')];
const filled = () => gs().every((i) => i.value.trim());

function resetHome() {
  $('daycount').textContent = `day ${current.day}`;
  if (current.doneToday) { gs().forEach((i, n) => { i.value = (current.todayItems?.[n] ?? ''); }); }
  $('submit').disabled = !filled();
}

gs().forEach((el, i) => {
  el.addEventListener('input', () => { $('submit').disabled = !filled(); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { if (!$('submit').disabled) $('submit').click(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (i < 2) gs()[i + 1].focus(); else if (!$('submit').disabled) $('submit').click(); }
  });
});

$('box').addEventListener('click', (e) => { if (!e.target.matches('input')) $('g1').focus(); });

$('submit').addEventListener('click', async () => {
  if (!filled()) return;
  const items = gs().map((i) => i.value.trim());
  $('submit').disabled = true;
  try {
    const data = await api('/api/submit', { items });
    current = { ...current, ...data, monthCount: (current.monthCount ?? 0) + 1 };
    renderDone(items);
    show('done');
  } catch {
    $('submit').disabled = false;
    // Fall back to showing the logged state locally so nothing feels lost.
    renderDone(items);
    show('done');
  }
});

// ── Done ────────────────────────────────────────────────────────────────────
// Rotating confirmation heading - deterministic by day number, dry, never keen.
const HEADINGS = [
  'Logged.', 'Logged. Slow clap.', 'Logged. Barely.', 'Logged, obviously.',
  'Logged. Steady on.', 'Noted.', 'Filed.', 'Filed away.', 'On the record.',
  'Duly noted.', 'Received.', 'In the book.', "That'll do.", 'Fine. Logged.',
  'Counted.', 'Banked.', 'Stamped.', 'Three things, logged.',
  'Recorded, reluctantly.', 'Sorted.', 'Down in writing.', 'Logged. Look at you.',
  'Done and logged.', 'Accepted.',
];
const MILESTONES = { 1: 'First one down.', 7: 'A week of this.', 30: 'Thirty days.', 100: 'One hundred.' };

function pickHeading(dayNum) {
  const d = Number.isFinite(dayNum) && dayNum > 0 ? dayNum : 1;
  if (MILESTONES[d]) return MILESTONES[d];
  if (d > 100 && d % 50 === 0) return `Day ${d}.`;
  return HEADINGS[d % HEADINGS.length];
}

function renderDone(items) {
  $('done-head').textContent = pickHeading(current.todayDayNum ?? current.day);
  $('streak').innerHTML = current.streak > 0
    ? `day ${current.day} · <b>streak ${current.streak}</b>`
    : `day ${current.day}`;
  $('logged').innerHTML = items.map((t, i) =>
    `<div class="g"><span class="n">0${i + 1}</span><span class="t">${esc(t)}</span></div>`).join('');
  const r = current.resurfaced;
  if (r && r.item) {
    $('echo-label').textContent = r.label;
    $('echo-text').textContent = `“${r.item}”`;
    $('echo').hidden = false;
  } else {
    $('echo').hidden = true;
  }

  $('mcount').textContent = `${current.monthCount ?? 0} this month`;

  const recent = (current.recent ?? []).filter((r) => r && r.date);
  $('recent').innerHTML = recent.map((r) => {
    const nice = fmtRecent(r.date);
    const first = (r.items?.[0] ?? '').trim();
    return `<div class="r"><span class="rd">${nice}</span><span class="rt">${esc(first)}…</span></div>`;
  }).join('');
  $('recent').parentElement.hidden = recent.length === 0;

  handleNote();
}

// The AI margin note: never blocks the screen, 4s timeout, fails silent, once/day.
function showNote(text, fade) {
  if (!text) { $('note').hidden = true; return; }
  $('note-text').textContent = `“${text}”`;
  $('note').hidden = false;
  if (fade) { $('note').classList.remove('in'); void $('note').offsetWidth; $('note').classList.add('in'); }
}

async function handleNote() {
  $('note').hidden = true;
  $('note').classList.remove('in');

  // Already have it (reload of a day whose note was generated): show at once.
  if (current.noteReady) { showNote(current.todayNote, false); return; }

  // Otherwise fetch once, with a hard 4s ceiling. Any failure = empty margin.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const data = await api('/api/note', {}, { signal: ctrl.signal });
    current.noteReady = true;
    current.todayNote = data.note ?? null;
    showNote(current.todayNote, true);
  } catch { /* silent - a note-less Logged screen is complete */ }
  finally { clearTimeout(timer); }
}

function fmtRecent(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

// ── Journal ─────────────────────────────────────────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmtDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
}

async function loadJournal() {
  let data;
  try { data = await api('/api/journal'); }
  catch { data = { entries: [], stats: { streak: current.streak, thisMonth: 0, allTime: 0 } }; }

  $('j-streak').textContent = data.stats.streak ?? 0;
  $('j-month').textContent = data.stats.thisMonth ?? 0;
  $('j-all').textContent = data.stats.allTime ?? 0;

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
    const todayTag = e.date === todayIso ? ' <em>· today</em>' : '';
    html += `<div class="entry"><div class="ehd"><span class="d">${fmtDay(e.date)}${todayTag}</span><span class="m">day ${e.dayNum ?? ''}</span></div>`
      + (e.items || []).map((g, i) => `<div class="jg n${i + 1}"><span class="n">0${i + 1}</span><span class="t">${esc(g)}</span></div>`).join('')
      + `</div>`;
  }
  list.innerHTML = html;
}

// ── About: reminders ────────────────────────────────────────────────────────
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

$('rem-sw').addEventListener('click', () => {
  saveReminder({ enabled: current.reminder.enabled ? false : requestNotifyThenTrue() });
});
// Ask for notification permission the moment they turn it on (never on load).
function requestNotifyThenTrue() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  return true;
}

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
    await api('/api/feedback', { message: email ? `${email}: ${msg}` : msg });
    $('c-msg').value = ''; $('c-email').value = '';
    const ok = $('c-ok'); ok.textContent = 'Got it. Cheers.'; ok.hidden = false;
  } catch {
    const ok = $('c-ok'); ok.textContent = "Didn't send - try the email link below."; ok.hidden = false;
  }
  $('c-send').disabled = false;
});

// ── Login: magic link ───────────────────────────────────────────────────────
$('signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('login-error').textContent = 'that email looks off'; return; }
  const btn = $('signin-btn');
  btn.disabled = true; btn.textContent = 'Sending…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) {
    $('login-error').textContent = "didn't send. try again.";
    btn.disabled = false; btn.textContent = 'Send me a link';
    return;
  }
  $('sent-to').textContent = email;
  $('login-card').hidden = true;
  $('login-sent').hidden = false;
});

// ── Rotating word (home) ────────────────────────────────────────────────────
(function rotor() {
  const slot = $('slot'), reel = slot.querySelector('.reel');
  const words = ['dudes', 'blokes', 'straight-talkers', 'yoga-haters', 'bad bitches', 'rationalists', 'cynics', 'overthinkers', 'sceptics', 'pessimists'].sort(() => Math.random() - 0.5);
  const cls = words.map((_, i) => 'w' + (i % 5 + 1));
  reel.innerHTML = words.concat(words[0]).map((w, i) => `<span class="${i < words.length ? cls[i] : cls[0]}">${w}</span>`).join('');
  slot.setAttribute('aria-label', words[0]);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let si = 0;
  setInterval(() => {
    si++;
    reel.style.transition = 'transform .42s cubic-bezier(.4,0,.2,1)';
    reel.style.transform = `translateY(-${si * 1.2}em)`;
    slot.setAttribute('aria-label', words[si % words.length]);
    if (si === words.length) setTimeout(() => { reel.style.transition = 'none'; reel.style.transform = 'none'; si = 0; }, 440);
  }, 1600);
})();

// ── Auth transfer + boot ────────────────────────────────────────────────────
async function activate(session) {
  try {
    await fetch('/api/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ anonId }),
    });
  } catch { /* non-fatal */ }
  history.replaceState(null, '', window.location.pathname);
}

sb.auth.onAuthStateChange(async (_e, session) => {
  if (!session || authSession?.access_token === session.access_token) return;
  authSession = session;
  await activate(session);
  await boot();
});

async function boot() {
  let state = null;
  try { state = await api('/api/state'); } catch { /* fresh, offline, or brand new */ }
  if (state) current = { ...current, ...state };

  paintReminder();

  if (current.doneToday) {
    renderDone(current.todayItems ?? []);
    show('done');
  } else {
    show('home');
  }
}

async function init() {
  anonId = getOrCreateAnonId();
  paintNav();
  const { data: { session } } = await sb.auth.getSession();
  if (session) { authSession = session; await activate(session); }
  await boot();
}

init();
