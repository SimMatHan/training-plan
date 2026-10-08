import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { weekForDate } from '../../shared/resolve';
import { usePlan } from '../data/plan';
import { startActivity, useRecentActivities } from '../data/workouts';
import { todayIso } from '../lib/dates';
import { Plus } from '@phosphor-icons/react';
import { PrimaryButton } from '../ui/Button';
import { ChoiceGrid, TextField } from '../ui/Field';
import { Sheet } from '../ui/Sheet';

const ANDET = 'Andet …';
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
      <p className="mb-4 text-secondary text-ink-2">Træning uden for planen. Du logger tid, puls, RPE og lysken bagefter.</p>
      <ChoiceGrid
        label="Aktivitet"
        columns={3}
        options={[...choices, ANDET]}
        value={custom ? ANDET : choices.includes(name) ? name : null}
        onChange={(c) => {
          setCustom(c === ANDET);
          setName(c === ANDET ? '' : c);
        }}
      />
      {custom && (
        <div className="mt-3">
          <TextField label="Hvilken aktivitet?" autoFocus type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}
      <div className="mt-4">
        <TextField label="Dato" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
      <PrimaryButton onClick={() => void start()} disabled={!name.trim() || busy} className="mt-6">
        Start {name.trim() || 'aktivitet'}
      </PrimaryButton>
    </Sheet>
  );
}

/** Knap der åbner arket. */
export function AddActivityButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card text-body font-medium text-ink-2">
        <Plus size={18} weight="bold" aria-hidden="true" /> Anden aktivitet (padel o.l.)
      </button>
      <AddActivitySheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
