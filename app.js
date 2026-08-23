/* global supabase */

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://ykaddcnbokbmwoyvurlr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYWRkY25ib2tibXdveXZ1cmxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTM0MDksImV4cCI6MjA5MjY4OTQwOX0.bzVSEswEGYpp8tXQQ5gpH_fdI3Rk5pWHqm9F5ALXIp0';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Reference data (labels only; the prompts live server-side) ──────────────
const PERSONALITIES = [
  ['Sarcastic Drill Instructor', '“Right, that’s your lot. Go and live your life.”'],
  ['Neutral', '“Logged. Three things, same time tomorrow.”'],
  ['Sports Commentator', '“AND THEY’VE DONE IT - extraordinary scenes.”'],
  ['Deluded Gym Bro', '“GRATITUDE GAINS. That’s a PB, brother.”'],
  ['Terrible Pun Comedian', '“Thanks a bunch. Get it? Because gratitude.”'],
];

const LEVELS = [
  ['First time', 'First go at this. Ease me in, anything counts.'],
  ['A bit', 'Done it a few times. Keep me honest.'],
  ['Experienced', 'Done this properly before. High bar, no coddling.'],
];

const TIMES = ['7:00 am', '12:00 pm', '6:00 pm', '8:00 pm', '9:30 pm'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ── Session state ───────────────────────────────────────────────────────────
let authSession = null;
let anonId = null;
let userState = { day: 1, streak: 0, grats_today: 0 };
let settings = { personality: 0, level: 1, team: '', displayName: '', sounds: true, notifEnabled: false, reminderTime: '8:00 pm', onboarded: false };
let journal = { entries: {}, since: null, stats: { streak: 0, allTime: 0 } };
let journalLoaded = false;
let viewMonth = new Date();
let selectedDay = null;

const $ = (id) => document.getElementById(id);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── Screen routing ──────────────────────────────────────────────────────────
const SCREENS = ['onboarding', 'chat', 'journal', 'menu'];

function show(name) {
  SCREENS.forEach((s) => $(`screen-${s}`).classList.toggle('on', s === name));
  window.scrollTo(0, 0);
  if (name === 'journal') loadJournal();
}

// ── Anonymous id ────────────────────────────────────────────────────────────
function getOrCreateAnonId() {
  let id = localStorage.getItem('gratidude_anon_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('gratidude_anon_id', id);
  }
  return id;
}

// ── API ─────────────────────────────────────────────────────────────────────
async function api(path, body = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const payload = { ...body };
  if (authSession) headers.Authorization = `Bearer ${authSession.access_token}`;
  else payload.anonId = anonId;

  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`${path} failed`);
  return res.json();
}

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  renderMenuValues();
  try {
    const data = await api('/api/settings', patch);
    if (data.settings) settings = data.settings;
  } catch { /* keep the optimistic value */ }
}

// ── Sound ───────────────────────────────────────────────────────────────────
let audioCtx = null;
function tick() {
  if (!settings.sounds) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.05, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.08);
  } catch { /* audio is a nicety, never a blocker */ }
}

/* ══════════════════════════════════════════════════════════════
   ONBOARDING
══════════════════════════════════════════════════════════════ */
const obPick = { level: 1, pers: 0, time: '8:00 pm' };
let obStep = 0;

const cardMarkup = (list, sel, key) => list.map(([nm, ex], i) =>
  `<button class="card${i === sel ? ' chosen' : ''}" data-pick="${key}" data-i="${i}">
     <span class="hd"><span class="nm">${esc(nm)}</span><span class="tag">▌ chosen</span></span>
     <p class="ex">${esc(ex)}</p>
   </button>`).join('');

function drawOnboarding() {
  $('ob-levels').innerHTML = cardMarkup(LEVELS, obPick.level, 'ob-level');
  $('ob-pers').innerHTML = cardMarkup(PERSONALITIES, obPick.pers, 'ob-pers');
  $('ob-times').innerHTML = TIMES.map((t) =>
    `<button class="time${t === obPick.time ? ' on' : ''}" data-obtime="${t}">${t}</button>`).join('');
}

const OB_LABELS = ['Start.', 'Next.', 'Next.', 'Next.', 'Turn nudges on.'];

function obGo(n) {
  if (n > 4) return finishOnboarding();
  obStep = n;
  document.querySelectorAll('#screen-onboarding .step').forEach((x) => x.classList.toggle('on', +x.dataset.s === obStep));
  $('ob-dots').querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i <= obStep));
  $('ob-next').textContent = OB_LABELS[obStep];
  $('ob-skip').hidden = obStep === 0;
  $('ob-skip').textContent = obStep === 4 ? "I'll risk it" : 'Skip';
}

async function finishOnboarding(withNudges = true) {
  const patch = {
    level: obPick.level,
    personality: obPick.pers,
    team: $('ob-team').value.trim(),
    reminderTime: obPick.time,
    notifEnabled: withNudges,
    onboarded: true,
  };
  show('chat');
  startChat();
  saveSettings(patch);
}

$('ob-dots').innerHTML = '<i class="on"></i>' + '<i></i>'.repeat(4);
drawOnboarding();
$('ob-next').addEventListener('click', () => obGo(obStep + 1));
$('ob-skip').addEventListener('click', () => {
  if (obStep === 4) return finishOnboarding(false);
  obGo(obStep + 1);
});

/* ══════════════════════════════════════════════════════════════
   CHAT
══════════════════════════════════════════════════════════════ */
const chatScreen = $('screen-chat');
const thread = $('thread');
const inputEl = $('chat-input');
const sendBtn = $('send-btn');
const composer = $('composer');
const doneFooter = $('done-footer');

function appendAI(html, opening = false) {
  const el = document.createElement('div');
  el.className = 'ai enter';
  el.innerHTML = html + (opening ? '<span class="caret"></span>' : '');
  thread.appendChild(el);
  scrollThread();
  return el;
}

function appendUser(text) {
  const el = document.createElement('div');
  el.className = 'user enter';
  el.textContent = text;
  thread.appendChild(el);
  scrollThread();
}

function showThinking() {
  const el = document.createElement('div');
  el.className = 'thinking';
  el.textContent = '·';
  thread.appendChild(el);
  scrollThread();
  let n = 1;
  el._t = setInterval(() => { n = (n % 3) + 1; el.textContent = '·'.repeat(n); }, 280);
  return el;
}

const removeThinking = (el) => { if (el) { clearInterval(el._t); el.remove(); } };
const scrollThread = () => { thread.scrollTop = thread.scrollHeight; };

function updateChrome(state) {
  if (!state) return;
  userState = { ...userState, ...state };
  $('streak-meta').innerHTML = userState.streak > 0
    ? `day ${userState.day} · <b>streak ${userState.streak}</b>`
    : `day ${userState.day}`;
}

function showDoneState() {
  composer.hidden = true;
  doneFooter.hidden = false;
  thread.querySelectorAll('.user').forEach((u) => u.classList.add('spent'));
}

function startChat() {
  thread.innerHTML = '';
  composer.hidden = false;
  doneFooter.hidden = true;
  chatScreen.classList.add('opening');
  updateChrome(userState);

  const day = userState.day;
  const opener = day <= 1
    ? "Right. Three things you're grateful for. <span class=\"soft\">Go.</span>"
    : `Day ${day}. Three things. <span class="soft">Go.</span>`;
  appendAI(opener, true);
  inputEl.focus();
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  chatScreen.classList.remove('opening');
  thread.querySelectorAll('.caret').forEach((c) => c.remove());

  inputEl.value = '';
  inputEl.style.height = 'auto';
  sendBtn.disabled = true;
  appendUser(text);
  tick();
  const thinking = showThinking();

  try {
    const data = await api('/api/chat', { message: text });
    removeThinking(thinking);

    if (data.error === 'rate_limited') {
      appendAI(esc(data.reply));
      showDoneState();
      return;
    }

    if (data.reply) appendAI(esc(data.reply));
    if (data.settings) settings = data.settings;
    updateChrome(data.userState);

    if (data.done || data.requiresSignup) {
      showDoneState();
      journalLoaded = false;
      if (data.requiresSignup) {
        await delay(600);
        showSignupPanel('One down.');
      }
    }
  } catch {
    removeThinking(thinking);
    const err = document.createElement('div');
    err.className = 'msg-error';
    err.textContent = "couldn't send that. try again.";
    thread.appendChild(err);
    inputEl.value = text;
    scrollThread();
  }

  sendBtn.disabled = !inputEl.value.trim();
}

sendBtn.addEventListener('click', sendMessage);

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
  sendBtn.disabled = !inputEl.value.trim();
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !sendBtn.disabled) {
    e.preventDefault();
    sendMessage();
  }
});

$('go-journal').addEventListener('click', () => show('journal'));
$('go-menu').addEventListener('click', () => show('menu'));

/* ══════════════════════════════════════════════════════════════
   JOURNAL
══════════════════════════════════════════════════════════════ */
async function loadJournal() {
  if (!journalLoaded) {
    try {
      journal = await api('/api/journal');
      journalLoaded = true;
    } catch { /* render whatever we have */ }
  }
  renderMonth();
}

function renderMonth() {
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const now = new Date();
  const isThisMonth = y === now.getFullYear() && m === now.getMonth();

  $('j-month').textContent = MONTHS[m] + (y === now.getFullYear() ? '' : ` ${y}`);
  $('j-next').disabled = isThisMonth;

  const daysInMonth = new Date(y, m + 1, 0).getDate();
  // Grid starts Monday, so shift Sunday (0) to the end.
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7;

  let monthCount = 0;
  const grid = $('j-grid');
  grid.innerHTML = '';

  for (let i = 0; i < startDow; i++) {
    const b = document.createElement('div');
    b.className = 'day blank';
    grid.appendChild(b);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateKey(new Date(y, m, d));
    const entry = journal.entries[key];
    const cellDate = new Date(y, m, d);
    const isFuture = cellDate > now && !(isThisMonth && d === now.getDate());
    const isToday = isThisMonth && d === now.getDate();
    // Days before you started are inert, not failures.
    const isPre = journal.since ? key < journal.since : false;
    if (entry) monthCount++;

    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = d;
    b.dataset.key = key;
    const mark = isFuture ? 'future' : isPre ? 'future' : entry ? 'has' : 'miss';
    b.className = `day ${mark}${isToday ? ' today' : ''}`;
    if (!isFuture && !isPre) b.addEventListener('click', () => selectDay(key));
    grid.appendChild(b);
  }

  $('j-streak').textContent = journal.stats.streak ?? 0;
  $('j-month-count').textContent = monthCount;
  $('j-all').textContent = journal.stats.allTime ?? 0;

  // Land on the most recent day with an entry in this month, else today.
  const keys = Object.keys(journal.entries).filter((k) => k.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`)).sort();
  selectDay(selectedDay && journal.entries[selectedDay] ? selectedDay : (keys.pop() ?? dateKey(now)));
}

function selectDay(key) {
  selectedDay = key;
  document.querySelectorAll('#j-grid .day').forEach((x) => x.classList.toggle('sel', x.dataset.key === key));

  const [y, m, d] = key.split('-').map(Number);
  const nice = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
  $('j-date').textContent = nice;

  const entry = journal.entries[key];
  $('j-meta').textContent = entry ? `day ${entry.dayNum ?? ''}`.trim() : 'no entry';

  const box = $('j-entry-body');
  if (!entry || !entry.items?.length) {
    box.innerHTML = '<p class="empty">Nothing. You didn’t show up that day.</p>';
    return;
  }
  box.innerHTML = `<div class="stack">${entry.items.map((g, i) =>
    `<div class="g"><span class="n">0${i + 1}</span><span class="t">${esc(g)}</span></div>`).join('')}</div>`;
}

$('j-prev').addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); selectedDay = null; renderMonth(); });
$('j-next').addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); selectedDay = null; renderMonth(); });

/* ══════════════════════════════════════════════════════════════
   MENU
══════════════════════════════════════════════════════════════ */
const detail = $('menu-detail');

const rowsWrap = (inner) => `<div class="rows">${inner}</div>`;
const swRow = (label, on, key) =>
  `<div class="row"><span class="lab">${label}</span><button class="sw" role="switch" aria-checked="${on}" data-tog="${key}" aria-label="${label}"></button></div>`;
const navRow = (label, val) =>
  `<div class="row"><span class="lab">${label}</span><span class="val"><em>${esc(val)}</em><span class="chev">›</span></span></div>`;

const VIEWS = {
  personality: () => ({
    h: 'Meet your guide.',
    l: "Choose my personality. Change it whenever you like - I'll pick up where we left off.",
    b: cardMarkup(PERSONALITIES, settings.personality, 'personality'),
  }),
  level: () => ({
    h: 'Have you done this before?',
    l: 'Pick whatever fits. This sets how I talk to you - you can change it any time.',
    b: cardMarkup(LEVELS, settings.level, 'level'),
  }),
  sounds: () => ({
    h: 'Sounds',
    l: 'The only noise I make.',
    b: rowsWrap(swRow('Tap sound', settings.sounds, 'sounds')),
  }),
  notifications: () => ({
    h: 'Notifications',
    l: "Double your chances - I'll nudge you once a day.",
    b: rowsWrap(swRow('Daily reminder', settings.notifEnabled, 'notifEnabled'))
      + `<div class="times">${TIMES.map((t) =>
        `<button class="time${t === settings.reminderTime ? ' on' : ''}" data-settime="${t}">${t}</button>`).join('')}</div>`
      + `<p class="note">Browser reminders need permission and don't work on iOS unless you add the site to your home screen. Not wired up yet - this just remembers the time.</p>`,
  }),
  profile: () => ({
    h: 'Profile',
    b: `<div class="field"><label class="smallcaps" for="pf-name">what I call you</label><input id="pf-name" value="${esc(settings.displayName)}" placeholder="your name"></div>`
      + `<div class="field"><label class="smallcaps" for="pf-team">team</label><input id="pf-team" value="${esc(settings.team)}" placeholder="go on, admit it"></div>`
      + (authSession
        ? rowsWrap(navRow('Email', authSession.user?.email ?? '') + '<button class="row dest" data-signout><span class="lab">Sign out</span></button>')
        : rowsWrap('<button class="row" data-savejournal><span class="lab">Save my journal</span><span class="val"><em>not saved</em><span class="chev">›</span></span></button>')
          + `<p class="note">Right now this lives in one browser. Add an email and it follows you anywhere.</p>`),
    f: '<button class="slab full" data-saveprofile>Save.</button>',
  }),
  about: () => ({
    h: 'About',
    b: `<p class="lede">Gratidude asks for three things you're grateful for. No affirmations. No waffle. No bullshit.</p>`
      + rowsWrap(navRow('Version', '2.0 (web beta)')),
  }),
  feedback: () => ({
    h: 'Send feedback',
    l: "Tell me what's wrong with me. Briefly.",
    b: `<div class="field"><label class="smallcaps" for="fb-msg">message</label><input id="fb-msg" placeholder="go on then"></div><div id="fb-ok"></div>`,
    f: '<button class="slab full" data-sendfeedback>Send it.</button>',
  }),
  help: () => ({
    h: 'Help',
    b: `<p class="lede">Three things a day. That's the whole thing.</p>`
      + `<p class="note">Missed a day? The streak resets, nothing else. The journal keeps every day you did show up.</p>`
      + `<p class="note">Stuck? Say so and I'll give you a prompt. Bare nouns count on the easier levels.</p>`,
  }),
};

function openView(k) {
  const v = VIEWS[k]();
  detail.innerHTML = `<button class="back" data-back>← menu</button>`
    + `<h1 class="big">${v.h}</h1>`
    + (v.l ? `<p class="lede">${v.l}</p>` : '')
    + v.b
    + (v.f ? `<div class="menu-foot">${v.f}</div>` : '');
  detail.dataset.k = k;
  if (window.innerWidth < 900) {
    $('menu-index').classList.remove('on');
    detail.classList.add('on');
  }
}

function renderMenuValues() {
  $('v-personality').textContent = PERSONALITIES[settings.personality][0];
  $('v-level').textContent = LEVELS[settings.level][0];
  $('v-sounds').textContent = settings.sounds ? 'On' : 'Off';
  $('v-notif').textContent = settings.notifEnabled ? settings.reminderTime : 'off';
  $('v-profile').textContent = settings.displayName || (authSession ? 'signed in' : 'anonymous');
}

document.addEventListener('click', async (e) => {
  // Cross-screen nav
  const go = e.target.closest('[data-go]');
  if (go) return show(go.dataset.go);

  const open = e.target.closest('[data-open]');
  if (open) return openView(open.dataset.open);

  if (e.target.closest('[data-back]')) {
    detail.classList.remove('on');
    $('menu-index').classList.add('on');
    return;
  }

  // Card pickers (onboarding + menu)
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const key = pick.dataset.pick;
    const i = +pick.dataset.i;
    if (key === 'ob-level') { obPick.level = i; drawOnboarding(); return; }
    if (key === 'ob-pers') { obPick.pers = i; drawOnboarding(); return; }
    await saveSettings({ [key]: i });
    openView(detail.dataset.k);
    return;
  }

  const obTime = e.target.closest('[data-obtime]');
  if (obTime) { obPick.time = obTime.dataset.obtime; drawOnboarding(); return; }

  const setTime = e.target.closest('[data-settime]');
  if (setTime) {
    await saveSettings({ reminderTime: setTime.dataset.settime });
    openView('notifications');
    return;
  }

  const swtch = e.target.closest('.sw');
  if (swtch) {
    const on = swtch.getAttribute('aria-checked') !== 'true';
    swtch.setAttribute('aria-checked', on);
    await saveSettings({ [swtch.dataset.tog]: on });
    return;
  }

  if (e.target.closest('[data-saveprofile]')) {
    await saveSettings({
      displayName: $('pf-name').value.trim(),
      team: $('pf-team').value.trim(),
    });
    const btn = e.target.closest('[data-saveprofile]');
    btn.textContent = 'Saved.';
    setTimeout(() => { btn.textContent = 'Save.'; }, 1400);
    return;
  }

  if (e.target.closest('[data-savejournal]')) {
    show('chat');
    showSignupPanel('Save your journal.');
    return;
  }

  if (e.target.closest('[data-signout]')) {
    await sb.auth.signOut();
    location.reload();
    return;
  }

  if (e.target.closest('[data-sendfeedback]')) {
    const msg = $('fb-msg').value.trim();
    if (!msg) return;
    try {
      await api('/api/feedback', { message: msg });
      $('fb-msg').value = '';
      $('fb-ok').innerHTML = '<p class="ok-note">Got it.</p>';
    } catch {
      $('fb-ok').innerHTML = '<p class="msg-error">didn’t send. try again.</p>';
    }
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth >= 900) {
    $('menu-index').classList.add('on');
    detail.classList.add('on');
    if (!detail.dataset.k) openView('personality');
  }
});

/* ══════════════════════════════════════════════════════════════
   SIGN-UP
══════════════════════════════════════════════════════════════ */
const signupPanel = $('signup-panel');
const signupEmail = $('signup-email');
const signupBtn = $('signup-btn');

function showSignupPanel(heading) {
  $('signup-heading').textContent = heading;
  $('signup-view-prompt').hidden = false;
  $('signup-view-sent').hidden = true;
  signupPanel.hidden = false;
  signupEmail.focus();
}

const hideSignupPanel = () => { signupPanel.hidden = true; };

signupEmail.addEventListener('input', () => {
  signupBtn.disabled = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail.value.trim());
  $('signup-error').textContent = '';
});

signupEmail.addEventListener('keydown', (e) => { if (e.key === 'Enter') signupBtn.click(); });

signupBtn.addEventListener('click', async () => {
  signupBtn.disabled = true;
  signupBtn.textContent = 'Sending…';

  const { error } = await sb.auth.signInWithOtp({
    email: signupEmail.value.trim(),
    options: { emailRedirectTo: window.location.origin },
  });

  if (error) {
    $('signup-error').textContent = "didn't catch that. try again.";
    signupBtn.disabled = false;
    signupBtn.textContent = 'Keep my streak.';
    return;
  }

  $('signup-view-prompt').hidden = true;
  $('signup-view-sent').hidden = false;
});

$('skip-signup').addEventListener('click', hideSignupPanel);

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

sb.auth.onAuthStateChange(async (_event, session) => {
  if (!session || authSession?.access_token === session.access_token) return;
  authSession = session;
  await activate(session);
  hideSignupPanel();
  journalLoaded = false;
  await boot();
});

/* ══════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════ */
async function boot() {
  let init = null;
  try {
    init = await api('/api/chat', { message: '__init__' });
  } catch { /* brand new session */ }

  if (init?.settings) settings = init.settings;
  if (init?.userState) userState = init.userState;
  renderMenuValues();
  // The desktop detail pane may have rendered before settings arrived.
  if (detail.dataset.k) openView(detail.dataset.k);

  // Anonymous, day one already done, new day: they must sign up to carry on.
  if (init?.requiresSignup && !authSession) {
    show('chat');
    thread.innerHTML = '';
    composer.hidden = true;
    doneFooter.hidden = true;
    appendAI("You're back. Enter your email to keep your streak.");
    showSignupPanel("You're back.");
    return;
  }

  // First run: onboarding. Skippable at every step after the welcome.
  if (!settings.onboarded && userState.day === 1 && userState.grats_today === 0 && !init?.done) {
    obPick.level = settings.level;
    obPick.pers = settings.personality;
    obPick.time = settings.reminderTime;
    drawOnboarding();
    obGo(0);
    show('onboarding');
    return;
  }

  show('chat');

  if (init?.done) {
    thread.innerHTML = '';
    updateChrome(userState);
    const streakNote = userState.streak > 1 ? ` ${userState.streak} days.` : '';
    appendAI(`Done for today.${streakNote} See you tomorrow.`);
    showDoneState();
    return;
  }

  if (userState.grats_today > 0) {
    thread.innerHTML = '';
    composer.hidden = false;
    doneFooter.hidden = true;
    updateChrome(userState);
    appendAI(userState.grats_today === 1 ? 'One down. Two more.' : 'Two down. One more.');
    inputEl.focus();
    return;
  }

  startChat();
}

async function init() {
  anonId = getOrCreateAnonId();

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    authSession = session;
    await activate(session);
  }

  if (window.innerWidth >= 900) openView('personality');
  await boot();
}

init();
