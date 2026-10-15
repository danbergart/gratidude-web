// Usage digest to Telegram, every third day at 07:00 UTC (8am UK in summer, 7am in winter).
// The schedule runs daily and skips two days in three: cron's */3 would reset at the
// start of each month, giving an odd 1-day gap.
import { supabase } from '../lib/session.mjs';
import { buildDigest } from '../lib/stats.mjs';
import { tell } from '../lib/notify.mjs';

const EVERY_DAYS = 3;

export default async () => {
  const dayNumber = Math.floor(Date.now() / 86400000);
  if (dayNumber % EVERY_DAYS !== 0) return;
  await tell(await buildDigest(supabase, new Date(), EVERY_DAYS));
};

export const config = { schedule: '0 7 * * *' };
