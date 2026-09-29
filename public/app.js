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
let current = { day: 1, streak: 0, doneToday: false };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getOrCreateAnonId() {
  let id = localStorage.getItem('gratidude_anon_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('gratidude_anon_id', id); }
  return id;
}

// Every API call gets a hard timeout, so a stalled request can never leave a
// screen hanging on a loading state.
async function api(path, body = {}, { timeout = 8000 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const payload = { ...body };
  if (authSession) headers.Authorization = `Bearer ${authSession.access_token}`;
  else payload.anonId = anonId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
    if (!res.ok) { const e = new Error(path); e.status = res.status; e.body = await res.json().catch(() => ({})); throw e; }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// One rule for every primary button: disabled until its form is valid.
function gate(btn, isValid, fields) {
  const update = () => { btn.disabled = !isValid(); };
  fields.forEach((f) => f.addEventListener('input', update));
  update();
  return update;
}

// ── Screen routing + menu ───────────────────────────────────────────────────
const SCREENS = ['home', 'journal', 'habit', 'about', 'login'];

function show(name) {
  if (name !== 'home') editing = false;
  SCREENS.forEach((s) => $(s).classList.toggle('on', s === name));
  window.scrollTo(0, 0);
  if (name === 'home') { paintHome(); if (!current.doneToday || editing) $('g1').focus(); }
  if (name === 'journal') loadJournal();
  if (name === 'login') paintLogin();
}

function toggleMenu(force) {
  $('menu').classList.toggle('on', force === undefined ? undefined : force);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-menu]')) { e.preventDefault(); toggleMenu(); return; }
  if (e.target.closest('[data-contact]')) { e.preventDefault(); toggleMenu(false); openContact(); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed) { e.preventDefault(); startEdit(); return; }
  const go = e.target.closest('[data-go]');
  if (go) {
    e.preventDefault(); toggleMenu(false);
    // Already home: don't repaint, or the wordmark would wipe half-typed entries.
    if (go.dataset.go === 'home' && $('home').classList.contains('on')) { window.scrollTo(0, 0); return; }
    show(go.dataset.go);
    const anchor = go.dataset.anchor && $(go.dataset.anchor);
    if (anchor) requestAnimationFrame(() => anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
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
  gs().forEach((el, i) => { el.placeholder = `e.g. ${picks[i]}`; });
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
    $('cmd').innerHTML = 'Changed your mind? <span class="dim">Typical.</span>';
    gs().forEach((i, n) => { i.value = current.todayItems?.[n] ?? ''; i.closest('.row').classList.toggle('filled', !!i.value.trim()); });
    $('submit').textContent = 'Save changes';
  } else {
    $('cmd').innerHTML = writingCommandHTML();
    gs().forEach((i) => { i.value = ''; i.closest('.row').classList.remove('filled'); });
    setPlaceholders();
    $('submit').textContent = 'Submit';
  }
  updateSubmit();
}

function startEdit() { editing = true; show('home'); }

const updateSubmit = gate($('submit'), filled, gs());
$('form').addEventListener('input', (e) => {
  const row = e.target.closest('.row');
  if (row) row.classList.toggle('filled', !!e.target.value.trim());
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
  "Well done.\nPat on the head.",
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
  $('cmd').innerHTML = esc(text).replace(/\n/g, '<br>');
  if (fade) { $('cmd').style.opacity = '0'; requestAnimationFrame(() => { $('cmd').style.transition = 'opacity .2s linear'; $('cmd').style.opacity = '1'; }); }
}

// A stock verdict, picked deterministically by day number. Nothing you write
// is ever sent anywhere to generate this — it's a fixed line from a local pool.
function handleNote() {
  const dayNum = current.todayDayNum ?? current.day;
  showQuote(pickQuip(dayNum), true);
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
    if (label !== lastMonth) { html += `<p class="marker mlabel">${label}</p>`; lastMonth = label; }
    const isToday = e.date === todayIso;
    const dateLine = isToday ? `Today <span class="dsub">${fmtDay(e.date)}</span>` : fmtDay(e.date);
    html += `<div class="entry${isToday ? ' is-today' : ''}"><div class="ehd"><span class="d">${dateLine}</span></div>`
      + (e.items || []).map((g, i) => `<div class="jg n${i + 1}"><span class="n">0${i + 1}</span><span class="t">${esc(g)}</span></div>`).join('')
      + `</div>`;
  }
  list.innerHTML = html;
}

// A failed load shows an error with a retry, never a fake empty journal.
// Only the latest request may update the screen.
let journalReq = 0;
async function loadJournal() {
  const req = ++journalReq;
  $('j-error').hidden = true;
  if (journalCache) renderJournal(journalCache);
  else { $('j-list').innerHTML = ''; $('j-summary').hidden = true; $('j-empty').hidden = true; $('j-loading').hidden = false; }
  try {
    const data = await api('/api/journal');
    if (req !== journalReq) return;
    journalCache = data;
    renderJournal(data);
  } catch {
    if (req !== journalReq) return;
    if (!journalCache) $('j-error').hidden = false;
  } finally {
    if (req === journalReq) $('j-loading').hidden = true;
  }
}
$('j-retry').addEventListener('click', loadJournal);

// ── Contact form: one component, mounted in About and the bug modal ─────────
// Message is required; email is optional but must be valid if given.
function mountContactForm(slot, type, { onSent } = {}) {
  const form = $('contact-tpl').content.firstElementChild.cloneNode(true);
  const email = form.elements.email;
  const msg = form.elements.message;
  const btn = form.querySelector('.btn');
  const ok = form.querySelector('.ok');
  form.querySelectorAll('label[data-for]').forEach((l) => {
    const field = form.elements[l.dataset.for];
    field.id = `${type}-${l.dataset.for}`;
    l.htmlFor = field.id;
  });

  const valid = () => !!msg.value.trim() && (!email.value.trim() || EMAIL_RE.test(email.value.trim()));
  const update = gate(btn, valid, [email, msg]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!valid()) return;
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api('/api/feedback', { email: email.value.trim(), message: msg.value.trim(), type });
      form.reset();
      ok.textContent = 'Got it. Now sod off and have a day.';
      onSent?.();
    } catch {
      ok.textContent = "Didn't send. Email hello@gratidude.ai instead.";
    }
    ok.hidden = false;
    btn.textContent = 'Send it';
    update();
  });

  slot.append(form);
  return {
    reset() { form.reset(); ok.hidden = true; btn.textContent = 'Send it'; update(); },
    focus() { email.focus(); },
  };
}

mountContactForm($('about-contact'), 'general');
const bugForm = mountContactForm($('modal-contact'), 'bug', { onSent: () => setTimeout(closeContact, 1600) });

function openContact() {
  bugForm.reset();
  $('contact-modal').hidden = false;
  bugForm.focus();
}
function closeContact() { $('contact-modal').hidden = true; }
$('contact-close').addEventListener('click', closeContact);
$('contact-modal').addEventListener('click', (e) => { if (e.target === $('contact-modal')) closeContact(); });

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
const updateSignin = gate($('signin-btn'), () => EMAIL_RE.test($('email').value.trim()), [$('email')]);
$('email').addEventListener('input', () => { $('login-error').textContent = ''; });
$('signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  if (!EMAIL_RE.test(email)) { $('login-error').textContent = 'that email looks off'; return; }
  const btn = $('signin-btn');
  btn.disabled = true; btn.textContent = 'Sending…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) { $('login-error').textContent = "didn't send. try again."; btn.textContent = 'Send me a link'; updateSignin(); return; }
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

// Home is already painted with defaults by the time this lands (it can take
// seconds on a cold start). Only repaint if the user is still on Home and the
// real state flips it to done; never pull them off another screen or clear
// what they're typing.
async function boot() {
  let state = null;
  try { state = await api('/api/state'); } catch { /* fresh, offline, or brand new */ }
  if (!state) return;
  current = { ...current, ...state };
  if ($('home').classList.contains('on') && current.doneToday && !editing) show('home');
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
