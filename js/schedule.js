// Routine schedules, set in Settings and kept in Feedback/routines.json. Times are Central (America/Chicago),
// which is what the scheduler (.github/scripts/scheduler.py) uses. Days: 0 = Sunday … 6 = Saturday.
//
//   { id, days: [1,2,3,4,5], type: 'at', time: '06:00', model: 'sonnet' }
//   { id, days: [1,2,3,4,5], type: 'every', every: 60, from: '08:30', to: '17:30', model: 'haiku' }

export const TZ = 'America/Chicago';
export const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const EVERY = [15, 30, 60, 90, 120, 180, 240];

const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });

// Wall-clock parts of a moment in Central time.
export function central(date = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, dow: DAY_SHORT.indexOf(p.weekday) };
}

// The moment when Central wall time is y-mo-d h:mi.
export function fromCentral(y, mo, d, h, mi) {
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const c = central(new Date(t));
    t -= (Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi) - Date.UTC(y, mo - 1, d, h, mi));
  }
  return new Date(t);
}

const mins = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':'); return (+h || 0) * 60 + (+m || 0); };
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function timesOfDay(s) {
  if (s.type === 'every') {
    const step = Math.max(15, +s.every || 60), out = [];
    for (let m = mins(s.from || '00:00'); m <= mins(s.to || '23:59'); m += step) out.push(m);
    return out;
  }
  return [mins(s.time)];
}

// Next time this schedule fires after `from`.
export function nextOf(s, from = new Date()) {
  if (s.paused || !s.days?.length) return null;
  const c = central(from);
  for (let add = 0; add < 8; add++) {
    const day = new Date(Date.UTC(c.y, c.mo - 1, c.d + add));
    const dow = day.getUTCDay();
    if (!s.days.includes(dow)) continue;
    for (const m of timesOfDay(s)) {
      const t = fromCentral(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(m / 60), m % 60);
      if (t > from) return t;
    }
  }
  return null;
}

// The next run of a routine (or of any routine in a list): { at, routine, schedule }.
export function nextRunOf(routines, from = new Date()) {
  let best = null;
  for (const r of routines) for (const s of r.schedules ?? []) {
    const at = nextOf(s, from);
    if (at && (!best || at < best.at)) best = { at, routine: r, schedule: s };
  }
  return best;
}

export function clock12(hm) {
  const m = mins(hm);
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

export function daysLabel(days = []) {
  const d = [...new Set(days)].sort((a, b) => a - b);
  const key = d.join('');
  if (key === '0123456') return 'Every day';
  if (key === '12345') return 'Weekdays';
  if (key === '06') return 'Weekends';
  if (!d.length) return 'No days';
  // Runs of three or more read as ranges: Mon–Thu.
  const parts = [];
  for (let i = 0; i < d.length;) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
    parts.push(j - i >= 2 ? `${DAY_SHORT[d[i]]}–${DAY_SHORT[d[j]]}` : d.slice(i, j + 1).map((x) => DAY_SHORT[x]).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}

export function everyLabel(n) {
  n = +n || 60;
  if (n % 60 === 0) return n === 60 ? 'every hour' : `every ${n / 60} hours`;
  return n > 60 ? `every ${Math.floor(n / 60)} h ${n % 60} min` : `every ${n} min`;
}

export function describe(s) {
  const days = daysLabel(s.days);
  if (s.type === 'every') return `${days}, ${everyLabel(s.every)} from ${clock12(s.from)} to ${clock12(s.to)}`;
  return `${days} at ${clock12(s.time)}`;
}

export const describeAll = (schedules = []) => (schedules.length ? schedules.map(describe).join('; ') : 'Not scheduled');

export function newSchedule(kind = 'at', model = 'sonnet') {
  const id = Math.random().toString(36).slice(2, 8);
  return kind === 'every'
    ? { id, days: [1, 2, 3, 4, 5], type: 'every', every: 60, from: '08:30', to: '17:30', model }
    : { id, days: [1, 2, 3, 4, 5], type: 'at', time: '07:00', model };
}

// Problems that would stop a schedule from ever running, in plain words.
export function problems(s) {
  if (!s.days?.length) return 'Pick at least one day.';
  if (s.type === 'every' && mins(s.to) < mins(s.from)) return 'The end time is before the start time.';
  if (s.type === 'every' && timesOfDay(s).length > 48) return 'That runs more than 48 times a day. Pick a longer interval or a shorter window.';
  if (s.type !== 'every' && !/^\d{2}:\d{2}$/.test(s.time || '')) return 'Pick a time.';
  return '';
}
