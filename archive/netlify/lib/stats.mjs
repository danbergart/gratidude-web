// Usage stats for the Telegram digest. Reads dates and ids only; never the
// `items` column, so nobody's gratitudes are ever touched.
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (isoDate, n) => iso(new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * DAY));
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const pct = (n, d) =>(d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : 'not enough data yet');

// rows: [{ user_id, anon_id, entry_date }]; today: 'YYYY-MM-DD' (UTC).
// windowDays: how many days this digest covers, i.e. how long since the last one.
export function summarise(rows, today, windowDays = 1) {
  const byPerson = new Map();
  for (const r of rows) {
    const key = r.user_id ?? r.anon_id;
    if (!byPerson.has(key)) byPerson.set(key, { dates: new Set(), account: !!r.user_id });
    byPerson.get(key).dates.add(r.entry_date);
  }
  const people = [...byPerson.values()].map((p) => {
    const dates = [...p.dates].sort();
    return { dates, days: dates.length, first: dates[0], last: dates.at(-1), account: p.account };
  });

  const yesterday = addDays(today, -1);
  const windowStart = addDays(today, -windowDays);
  const within = (p, from, to) => p.dates.some((d) => d >= from && d <= to);

  // "Came back in week 1": wrote again on days 2-7 after their first entry.
  // "Still around in week 2": wrote on days 8-14. Only people old enough to have had the chance count.
  const week1Cohort = people.filter((p) => p.first <= addDays(today, -7));
  const week2Cohort = people.filter((p) => p.first <= addDays(today, -14));
  const sortedDays = people.map((p) => p.days).sort((a, b) => a - b);

  return {
    recent: {
      wrote: people.filter((p) => within(p, windowStart, yesterday)).length,
      firstTimers: people.filter((p) => p.first >= windowStart && p.first <= yesterday).length,
      entries: rows.filter((r) => r.entry_date >= windowStart && r.entry_date <= yesterday).length,
    },
    writers: people.length,
    writersWithAccount: people.filter((p) => p.account).length,
    cameBackEver: people.filter((p) => p.days >= 2).length,
    active7: people.filter((p) => p.last >= addDays(today, -7)).length,
    active30: people.filter((p) => p.last >= addDays(today, -30)).length,
    week1: { returned: week1Cohort.filter((p) => within(p, addDays(p.first, 1), addDays(p.first, 6))).length, of: week1Cohort.length },
    week2: { returned: week2Cohort.filter((p) => within(p, addDays(p.first, 7), addDays(p.first, 13))).length, of: week2Cohort.length },
    medianDays: sortedDays.length ? sortedDays[Math.floor((sortedDays.length - 1) / 2)] : 0,
    buckets: {
      '1': people.filter((p) => p.days === 1).length,
      '2–3': people.filter((p) => p.days >= 2 && p.days <= 3).length,
      '4–7': people.filter((p) => p.days >= 4 && p.days <= 7).length,
      '8–14': people.filter((p) => p.days >= 8 && p.days <= 14).length,
      '15+': people.filter((p) => p.days >= 15).length,
    },
  };
}

export function formatDigest(s, extra, today, windowDays = 1) {
  const date = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const b = s.buckets;
  return [
    `<b>Gratidude · ${date}</b>`,
    '',
    `<b>${windowDays === 1 ? 'Yesterday' : `Last ${windowDays} days`}</b>`,
    `${s.recent.wrote} wrote their three (${s.recent.firstTimers} for the first time) · ${plural(s.recent.entries, 'entry', 'entries')} in total`,
    `${plural(extra.newVisitors, 'new visitor')} · ${plural(extra.newAccounts, 'new account')}`,
    '',
    '<b>All time</b>',
    `${extra.visitors} visitors → ${s.writers} wrote → ${s.cameBackEver} came back → ${s.writersWithAccount} saved with an account`,
    `Active in the last 7 days: ${s.active7} · last 30: ${s.active30}`,
    '',
    '<b>How long people stick</b>',
    `Days written per person: 1 day ${b['1']} · 2–3 ${b['2–3']} · 4–7 ${b['4–7']} · 8–14 ${b['8–14']} · 15+ ${b['15+']}`,
    `Median: ${plural(s.medianDays, 'day')}`,
    `Came back in their first week: ${pct(s.week1.returned, s.week1.of)}`,
    `Still writing in their second week: ${pct(s.week2.returned, s.week2.of)}`,
  ].join('\n');
}

async function allEntryDates(supabase) {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from('entries').select('user_id, anon_id, entry_date').order('id').range(from, from + size - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < size) return rows;
  }
}

async function count(supabase, table, from, to) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (from) q = q.gte('created_at', from).lt('created_at', to);
  const { count: n } = await q;
  return n ?? 0;
}

export async function buildDigest(supabase, now = new Date(), windowDays = 1) {
  const today = iso(now);
  const windowStart = addDays(today, -windowDays);
  const [rows, visitors, newVisitors, newAccounts] = await Promise.all([
    allEntryDates(supabase),
    count(supabase, 'anon_sessions'),
    count(supabase, 'anon_sessions', windowStart, today),
    count(supabase, 'web_users', windowStart, today),
  ]);
  return formatDigest(summarise(rows, today, windowDays), { visitors, newVisitors, newAccounts }, today, windowDays);
}
