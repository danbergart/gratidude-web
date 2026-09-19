// Pings to Dan's Telegram about usage: events and counts only, never what
// anyone wrote and never who they are. Does nothing until TELEGRAM_BOT_TOKEN
// and TELEGRAM_CHAT_ID are set in Netlify.
export async function tell(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* a stats ping must never break the app */ }
}

// Send after the response has gone back, so the user never waits on Telegram.
export function ping(context, text) {
  const p = tell(text);
  if (context?.waitUntil) context.waitUntil(p);
  return p;
}
