// Pick one past gratitude to show back to the user on the Logged screen.
// The reward of a gratitude journal is re-encountering your own past
// entries, so we prefer meaningful anniversaries, then fall back to the
// beginnings. Returns { label, item, date } or null.

const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const daysBetween = (a, b) => Math.round((a - b) / 86400000);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'} ago`;

export function pickResurfaced(entries, todayIso) {
  // Normalise to { date, items } and drop today + empty ones.
  const past = (entries || [])
    .map((e) => ({ date: e.date ?? e.entry_date, items: e.items || [] }))
    .filter((e) => e.date && e.date !== todayIso && e.items.length);
  if (!past.length) return null;

  const today = parse(todayIso);
  const [ty, tm, td] = todayIso.split('-').map(Number);

  const pickItem = (items) => items[Math.floor(Math.random() * items.length)];
  const make = (e, label) => ({ label, item: pickItem(e.items), date: e.date });

  // 1. Same calendar day, a whole year (or more) back.
  const yearAnniv = past
    .map((e) => { const [y, m, d] = e.date.split('-').map(Number); return { e, y, m, d }; })
    .filter((x) => x.m === tm && x.d === td && ty - x.y >= 1)
    .sort((a, b) => b.y - a.y)[0];
  if (yearAnniv) return make(yearAnniv.e, plural(ty - yearAnniv.y, 'year') + ' today');

  // 2. Same day-of-month in an earlier month.
  const monthAnniv = past
    .map((e) => ({ e, dt: parse(e.date), d: Number(e.date.split('-')[2]) }))
    .filter((x) => x.d === td && x.dt < today)
    .sort((a, b) => b.dt - a.dt)[0];
  if (monthAnniv) {
    const months = (ty - monthAnniv.dt.getUTCFullYear()) * 12 + (tm - 1 - monthAnniv.dt.getUTCMonth());
    if (months >= 1) return make(monthAnniv.e, plural(months, 'month') + ' today');
  }

  // 3. A round number of days ago.
  const byDate = new Map(past.map((e) => [e.date, e]));
  for (const n of [365, 100, 30, 7]) {
    const then = new Date(today); then.setUTCDate(then.getUTCDate() - n);
    const iso = then.toISOString().slice(0, 10);
    if (byDate.has(iso)) return make(byDate.get(iso), plural(n, 'day'));
  }

  // 4. Fallback: the oldest entry once there's a little history, else a random one.
  const sorted = [...past].sort((a, b) => parse(a.date) - parse(b.date));
  const oldest = sorted[0];
  const gap = daysBetween(today, parse(oldest.date));
  if (gap >= 5) return make(oldest, 'when you started');
  return make(past[Math.floor(Math.random() * past.length)], 'earlier');
}
