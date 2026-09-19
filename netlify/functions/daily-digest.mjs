// Daily usage digest to Telegram, 07:00 UTC (8am UK in summer, 7am in winter).
import { supabase } from '../lib/session.mjs';
import { buildDigest } from '../lib/stats.mjs';
import { tell } from '../lib/notify.mjs';

export default async () => {
  await tell(await buildDigest(supabase));
};

export const config = { schedule: '0 7 * * *' };
