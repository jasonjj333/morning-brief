// Settings → Routines: edit when each routine runs and which model each time slot uses.
// Edits stay in a draft (they survive redraws) until Save writes them to Feedback/routines.json.

import { esc } from './md.js';
import { DAY_LETTER, DAY_SHORT, EVERY, describe, everyLabel, newSchedule, nextOf, nextRunOf, problems } from './schedule.js';
import { toast } from './sheet.js';

const drafts = new Map(); // `${profile}:${routine}` → { schedules, run_model }
let getStore = () => null;
const clone = (x) => JSON.parse(JSON.stringify(x));
const keyOf = (store, rk) => `${store.profile.id}:${rk}`;
const whenLabel = (d) => d ? d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';

function current(store, r) {
  return drafts.get(keyOf(store, r.key)) ?? { schedules: clone(r.schedules ?? []), run_model: r.run_model ?? r.model ?? 'sonnet' };
}
const dirty = (store, r) => drafts.has(keyOf(store, r.key));

const modelOptions = (store, value) => store.models.map((m) => `<option value="${esc(m.value)}"${m.value === value ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
const modelLabel = (store, v) => store.models.find((m) => m.value === v)?.label ?? 'Sonnet 5.5';

function itemHTML(store, s, i) {
  const err = problems(s);
  const next = err ? null : nextOf(s);
  const days = DAY_LETTER.map((l, d) => `<button type="button" class="day-tog" data-day-tog="${d}" aria-pressed="${s.days.includes(d)}" aria-label="${DAY_SHORT[d]}">${l}</button>`).join('');
  const at = s.type !== 'every';
  return `<li class="sched-item" data-sid="${esc(s.id)}">
    <div class="sched-top">
      <div class="sched-days" role="group" aria-label="Days">${days}</div>
      <button type="button" class="sched-remove" data-sched-remove aria-label="Remove this time"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>
    </div>
    <div class="sched-row">
      <select class="sched-in" data-f="type" aria-label="Kind">
        <option value="at"${at ? ' selected' : ''}>At</option><option value="every"${at ? '' : ' selected'}>Every</option>
      </select>
      ${at
        ? `<input class="sched-in" type="time" data-f="time" value="${esc(s.time ?? '07:00')}" aria-label="Time" required>`
        : `<select class="sched-in" data-f="every" aria-label="Interval">${EVERY.map((n) => `<option value="${n}"${+s.every === n ? ' selected' : ''}>${everyLabel(n).replace(/^every /, '')}</option>`).join('')}</select>
           <span class="sched-word">from</span><input class="sched-in" type="time" data-f="from" value="${esc(s.from ?? '08:30')}" aria-label="From">
           <span class="sched-word">to</span><input class="sched-in" type="time" data-f="to" value="${esc(s.to ?? '17:30')}" aria-label="To">`}
    </div>
    <div class="sched-row">
      <label class="sched-model"><span>Model</span><select class="sched-in" data-f="model">${modelOptions(store, s.model ?? 'sonnet')}</select></label>
    </div>
    <p class="sched-desc${err ? ' is-error' : ''}" data-sched-desc>${esc(err || `${describe(s)}${next ? ` · next ${whenLabel(next)}` : ''}`)}</p>
  </li>`;
}

export function scheduleEditorHTML(store, r) {
  const c = current(store, r);
  const on = store.routinesDoc?.scheduler === 'on';
  return `<div class="sched" data-sched="${esc(r.key)}">
    ${c.schedules.length ? `<ul class="sched-list">${c.schedules.map((s, i) => itemHTML(store, s, i)).join('')}</ul>` : '<p class="muted small sched-none">No times set. This routine only runs when you tap Run now.</p>'}
    <div class="sched-add">
      <button type="button" class="btn btn-small" data-sched-add="at">Add a time</button>
      <button type="button" class="btn btn-small" data-sched-add="every">Add a repeating run</button>
    </div>
    <label class="sched-runnow"><span>Run now uses</span><select class="sched-in" data-sched-runmodel>${modelOptions(store, c.run_model)}</select></label>
    <div class="sched-foot">
      <button type="button" class="btn btn-primary" data-sched-save${dirty(store, r) ? '' : ' disabled'}>Save schedule</button>
      ${dirty(store, r) ? '<button type="button" class="text-btn" data-sched-discard>Discard changes</button>' : ''}
    </div>
    <p class="muted small">Times are Central. ${on ? 'Runs can start a few minutes late when GitHub is busy.' : 'These times take effect once the scheduler is switched on.'}</p>
  </div>`;
}

// One line for the routine card: the next run and its model.
export function nextRunLine(store, r) {
  const n = nextRunOf([{ ...r, schedules: r.schedules ?? [] }]);
  return n ? `Next ${whenLabel(n.at)} · ${modelLabel(store, n.schedule.model)}` : 'Not scheduled';
}

function redraw(box) {
  const store = getStore();
  const r = store?.routines.find((x) => x.key === box.dataset.sched);
  if (!r) return;
  const focus = document.activeElement && box.contains(document.activeElement)
    ? { sid: document.activeElement.closest('[data-sid]')?.dataset.sid, sel: document.activeElement.dataset.f ? `[data-f="${document.activeElement.dataset.f}"]` : document.activeElement.dataset.dayTog != null ? `[data-day-tog="${document.activeElement.dataset.dayTog}"]` : null }
    : null;
  box.outerHTML = scheduleEditorHTML(store, r);
  if (focus?.sid && focus.sel) document.querySelector(`[data-sched="${CSS.escape(r.key)}"] [data-sid="${CSS.escape(focus.sid)}"] ${focus.sel}`)?.focus({ preventScroll: true });
}

function edit(box, fn) {
  const store = getStore();
  const r = store.routines.find((x) => x.key === box.dataset.sched);
  const c = clone(current(store, r));
  fn(c, r);
  drafts.set(keyOf(store, r.key), c);
  return { store, r, c };
}

export function initScheduleUI(storeGetter) {
  getStore = storeGetter;

  document.addEventListener('click', async (e) => {
    const box = e.target.closest('[data-sched]');
    if (!box) return;
    const sid = e.target.closest('[data-sid]')?.dataset.sid;
    const tog = e.target.closest('[data-day-tog]');
    if (tog) {
      const d = +tog.dataset.dayTog;
      edit(box, (c) => { const s = c.schedules.find((x) => x.id === sid); s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort(); });
      return redraw(box);
    }
    if (e.target.closest('[data-sched-remove]')) { edit(box, (c) => { c.schedules = c.schedules.filter((x) => x.id !== sid); }); return redraw(box); }
    const add = e.target.closest('[data-sched-add]');
    if (add) { edit(box, (c) => { c.schedules.push(newSchedule(add.dataset.schedAdd, c.run_model || 'sonnet')); }); return redraw(box); }
    if (e.target.closest('[data-sched-discard]')) { const store = getStore(); drafts.delete(keyOf(store, box.dataset.sched)); return redraw(box); }
    const save = e.target.closest('[data-sched-save]');
    if (save) {
      const store = getStore();
      const key = box.dataset.sched;
      const c = drafts.get(keyOf(store, key));
      if (!c) return;
      const bad = c.schedules.map(problems).find(Boolean);
      if (bad) { toast(bad, { tone: 'error' }); return; }
      save.disabled = true; save.textContent = 'Saving…';
      try {
        await store.saveSchedules(key, c.schedules, c.run_model);
        drafts.delete(keyOf(store, key));
        const r = store.routines.find((x) => x.key === key);
        toast(`Saved. ${nextRunLine(store, r)}.`);
        for (const b of document.querySelectorAll(`[data-sched="${CSS.escape(key)}"]`)) {
          const meta = b.closest('.routine')?.querySelector('.routine-meta');
          if (meta) meta.textContent = nextRunLine(store, r);
          redraw(b);
        }
      } catch (err) {
        save.disabled = false; save.textContent = 'Save schedule';
        toast(err?.message || 'Could not save. Check your connection.', { tone: 'error' });
      }
    }
  });

  document.addEventListener('change', (e) => {
    const box = e.target.closest('[data-sched]');
    if (!box) return;
    if (e.target.matches('[data-sched-runmodel]')) { edit(box, (c) => { c.run_model = e.target.value; }); return redraw(box); }
    const f = e.target.dataset.f;
    if (!f) return;
    const sid = e.target.closest('[data-sid]')?.dataset.sid;
    edit(box, (c) => {
      const s = c.schedules.find((x) => x.id === sid);
      if (f === 'type') {
        Object.assign(s, e.target.value === 'every'
          ? { type: 'every', every: s.every ?? 60, from: s.from ?? '08:30', to: s.to ?? '17:30' }
          : { type: 'at', time: s.time ?? s.from ?? '07:00' });
      } else s[f] = f === 'every' ? +e.target.value : e.target.value;
    });
    redraw(box);
  });
}

// Drafts belong to one profile's routines; forget them when they no longer match anything.
export const clearScheduleDrafts = () => drafts.clear();
