/* global supabase */

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL     = 'https://ykaddcnbokbmwoyvurlr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrYWRkY25ib2tibXdveXZ1cmxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTM0MDksImV4cCI6MjA5MjY4OTQwOX0.bzVSEswEGYpp8tXQQ5gpH_fdI3Rk5pWHqm9F5ALXIp0';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Session state ─────────────────────────────────────────────────────────────
let authSession = null; // Supabase session if signed up
let anonId      = null; // UUID for anonymous users
let userState   = { day: 1, streak: 0, grats_today: 0 };

// ── DOM refs ─────────────────────────────────────────────────────────────────
const chatScreen   = document.getElementById('screen-chat');
const thread       = document.getElementById('thread');
const inputEl      = document.getElementById('chat-input');
const sendBtn      = document.getElementById('send-btn');
const composer     = document.getElementById('composer');
const doneFooter   = document.getElementById('done-footer');
const chromeMeta   = document.getElementById('chrome-meta');
const signupPanel  = document.getElementById('signup-panel');
const signupEmail  = document.getElementById('signup-email');
const signupBtn    = document.getElementById('signup-btn');
const signupError  = document.getElementById('signup-error');
const skipSignup   = document.getElementById('skip-signup');
const viewPrompt   = document.getElementById('signup-view-prompt');
const viewSent     = document.getElementById('signup-view-sent');

// ── Anon ID ───────────────────────────────────────────────────────────────────
function getOrCreateAnonId() {
  let id = localStorage.getItem('gratidude_anon_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('gratidude_anon_id', id);
  }
  return id;
}

// ── Chrome ────────────────────────────────────────────────────────────────────
function updateChrome(state) {
  if (!state) return;
  userState = { ...userState, ...state };
  if (state.streak > 0 || state.day > 1) {
    chromeMeta.innerHTML = `day <span>${state.day}</span> · streak <span class="gold">${state.streak}</span>`;
  }
}

// ── Thread helpers ────────────────────────────────────────────────────────────
function appendAI(text) {
  const el = document.createElement('div');
  el.className = 'msg-ai';
  el.textContent = text;
  thread.appendChild(el);
  scrollThread();
  return el;
}

function appendUser(text) {
  const el = document.createElement('div');
  el.className = 'msg-user';
  el.textContent = text;
  thread.appendChild(el);
  scrollThread();
}

function showThinking() {
  const el = document.createElement('div');
  el.className = 'msg-thinking';
  el.textContent = '·';
  thread.appendChild(el);
  scrollThread();
  let count = 1;
  el._interval = setInterval(() => {
    count = (count % 3) + 1;
    el.textContent = '·'.repeat(count);
  }, 280);
  return el;
}

function removeThinking(el) {
  if (el) { clearInterval(el._interval); el.remove(); }
}

function scrollThread() {
  thread.scrollTop = thread.scrollHeight;
}

function showDoneState() {
  thread.classList.add('done');
  composer.style.display = 'none';
  doneFooter.style.display = 'flex';
}

// ── API call ──────────────────────────────────────────────────────────────────
async function callChat(message) {
  const headers = { 'Content-Type': 'application/json' };
  const body    = { message };

  if (authSession) {
    headers['Authorization'] = `Bearer ${authSession.access_token}`;
  } else {
    body.anonId = anonId;
  }

  const res = await fetch('/api/chat', { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('chat_error');
  return res.json();
}

// ── Sign-up panel ─────────────────────────────────────────────────────────────
function showSignupPanel() {
  signupPanel.style.display = 'block';
  signupEmail.focus();
}

function hideSignupPanel() {
  signupPanel.style.display = 'none';
}

signupEmail.addEventListener('input', () => {
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail.value.trim());
  signupBtn.disabled = !valid;
  signupError.textContent = '';
});

signupEmail.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signupBtn.click();
});

signupBtn.addEventListener('click', async () => {
  const email = signupEmail.value.trim();
  signupBtn.disabled = true;
  signupBtn.textContent = 'Sending…';

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });

  if (error) {
    signupError.textContent = "didn't catch that. try again.";
    signupBtn.disabled = false;
    signupBtn.textContent = 'Keep my streak.';
    return;
  }

  viewPrompt.style.display = 'none';
  viewSent.style.display = 'flex';
});

skipSignup.addEventListener('click', hideSignupPanel);

// ── Auth state change (magic link return) ─────────────────────────────────────
sb.auth.onAuthStateChange(async (_event, session) => {
  if (!session || authSession?.access_token === session.access_token) return;
  authSession = session;

  // Transfer anon state to new account
  try {
    await fetch('/api/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ anonId }),
    });
  } catch { /* non-fatal */ }

  // Clean the URL
  history.replaceState(null, '', window.location.pathname);
  hideSignupPanel();
});

// ── Tucker intro (hardcoded, not Claude) ──────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function showTuckerIntro() {
  await delay(500);
  appendAI('Right.');
  await delay(1100);
  appendAI("I'm Tucker. Three things you're grateful for - that's the deal. Every day.");
  await delay(900);
  enableComposer();
}

function enableComposer() {
  composer.style.display = '';
  inputEl.focus();
}

// ── Chat send ─────────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;

  chatScreen.classList.remove('opening');
  inputEl.value = '';
  inputEl.style.height = 'auto';
  sendBtn.disabled = true;
  appendUser(text);
  const thinking = showThinking();

  try {
    const data = await callChat(text);
    removeThinking(thinking);

    if (data.error === 'rate_limited') {
      appendAI(data.reply);
      showDoneState();
      return;
    }

    if (data.reply) appendAI(data.reply);
    if (data.userState) updateChrome(data.userState);

    if (data.done || data.requiresSignup) {
      showDoneState();
      if (data.requiresSignup) {
        await delay(600);
        showSignupPanel();
      }
    }
  } catch {
    removeThinking(thinking);
    const errEl = document.createElement('div');
    errEl.className = 'msg-error';
    errEl.textContent = "couldn't send that. try again.";
    thread.appendChild(errEl);
    inputEl.value = text;
    scrollThread();
  }

  sendBtn.disabled = !inputEl.value.trim();
}

sendBtn.addEventListener('click', sendMessage);

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
  sendBtn.disabled = !inputEl.value.trim();
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    sendMessage();
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  chatScreen.classList.add('opening');
  anonId = getOrCreateAnonId();

  // Check for existing session (magic link return or returning signed-up user)
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    authSession = session;
    // Transfer anon state if returning via magic link
    try {
      await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ anonId }),
      });
    } catch { /* non-fatal */ }
    history.replaceState(null, '', window.location.pathname);
  }

  // Fetch current state
  let initData = null;
  try {
    initData = await callChat('__init__');
  } catch { /* fresh user, no DB row yet */ }

  // Anon user gated to sign up (completed day 1, new calendar day)
  if (initData?.requiresSignup && !authSession) {
    appendAI("You're back. Enter your email to keep your streak.");
    showSignupPanel();
    return;
  }

  if (initData?.userState) updateChrome(initData.userState);

  if (initData?.done) {
    chatScreen.classList.remove('opening');
    const streakNote = userState.streak > 1 ? ` ${userState.streak} days.` : '';
    appendAI(`Done for today.${streakNote} See you tomorrow.`);
    showDoneState();
    return;
  }

  // Returning mid-session (partially done today)
  if (initData?.userState?.grats_today > 0) {
    const g = initData.userState.grats_today;
    const left = 3 - g;
    appendAI(g === 1 ? `One down. Two more.` : `Two down. One more.`);
    enableComposer();
    return;
  }

  // Fresh start - show Tucker intro
  const day = initData?.userState?.day ?? 1;
  if (day > 1) {
    await delay(400);
    appendAI(`Day ${day}.`);
    await delay(700);
    enableComposer();
  } else {
    await showTuckerIntro();
  }
}

init();
