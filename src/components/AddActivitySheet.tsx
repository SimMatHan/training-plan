import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { weekForDate } from '../../shared/resolve';
import { usePlan } from '../data/plan';
import { startActivity, useRecentActivities } from '../data/workouts';
import { todayIso } from '../lib/dates';
import { Sheet } from './Sheet';

const DEFAULTS = ['Padel', 'Fodbold', 'Cykling', 'Svømning', 'Gåtur', 'Yoga'];

/** Tilføj en aktivitet uden for planen, fx padel. */
export function AddActivitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { active } = usePlan();
  const [, navigate] = useLocation();
  const recent = useRecentActivities();
  const [name, setName] = useState('');
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState(todayIso);
  const [busy, setBusy] = useState(false);
  const choices = [...new Set([...recent, ...DEFAULTS])].slice(0, 8);

  // Frisk start hver gang arket åbnes.
  useEffect(() => {
    if (!open) return;
    setName('');
    setCustom(false);
    setDate(todayIso());
  }, [open]);

  async function start() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const week = active ? weekForDate(active.plan, date) : undefined;
      const uuid = await startActivity({ name: trimmed, date, weekNo: week?.weekNo ?? null, planVersion: active?.meta.version ?? null });
      onClose();
      navigate(`/session/${uuid}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Anden aktivitet">
      <p className="mb-3 text-sm text-muted">Træning uden for planen. Du logger tid, puls, RPE og lysken bagefter.</p>
      <div role="group" aria-label="Aktivitet" className="grid grid-cols-3 gap-1.5">
        {choices.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={!custom && name === c}
            onClick={() => {
              setCustom(false);
              setName(c);
            }}
            className={`min-h-12 rounded-lg px-2 font-medium ${!custom && name === c ? 'bg-fg text-bg' : 'border border-line'}`}
          >
            {c}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => {
            setCustom(true);
            setName('');
          }}
          className={`min-h-12 rounded-lg px-2 font-medium ${custom ? 'bg-fg text-bg' : 'border border-line'}`}
        >
          Andet …
        </button>
      </div>
      {custom && (
        <label className="mt-3 flex flex-col gap-1 text-sm text-muted">
          Hvilken aktivitet?
          <input
            autoFocus
            type="text"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-12 rounded-lg border border-line bg-raised px-3 text-base text-fg"
          />
        </label>
      )}
      <label className="mt-4 flex flex-col gap-1 text-sm text-muted">
        Dato
        <input
          type="date"
          value={date}
          max={todayIso()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="min-h-12 rounded-lg border border-line bg-raised px-3 text-base text-fg"
        />
      </label>
      <button
        type="button"
        onClick={() => void start()}
        disabled={!name.trim() || busy}
        className="mt-5 min-h-14 w-full rounded-lg bg-fg text-lg font-semibold text-bg disabled:opacity-40"
      >
        Start {name.trim() || 'aktivitet'}
      </button>
    </Sheet>
  );
}

/** Knap der åbner arket. */
export function AddActivityButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line font-medium text-muted">
        <span aria-hidden="true" className="text-lg">+</span> Anden aktivitet (padel o.l.)
      </button>
      <AddActivitySheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
