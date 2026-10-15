import { ArrowDown, ArrowUp, CaretLeft, CaretRight, Plus } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useLocation, useRoute, useSearch } from 'wouter';
import type { Exercise, Plan, PlannedExercise, StrengthSession } from '../../shared/plan.schema';
import { applySessionEdit, defaultDose, draftFor, newExerciseId, scopeFor, type DraftSlot, type ScopeKind } from '../../shared/planEdit';
import { describePlanChange } from '../../shared/planDiff';
import { formatDose, formatIntensity, weekForDate } from '../../shared/resolve';
import { DoseEditor } from '../components/DoseEditor';
import { ExercisePicker } from '../components/ExercisePicker';
import { db } from '../data/db';
import { savePlanEdit, usePlan } from '../data/plan';
import { OfflineError } from '../lib/api';
import { formatShort, todayIso } from '../lib/dates';
import { PrimaryButton, SecondaryButton, SmallButton, TextButton } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Group } from '../ui/InsetList';
import { Segmented } from '../ui/Segmented';
import { ErrorText, Muted, Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';

/** Ugerne hvor sessionen står i planen. */
const scheduledWeeks = (plan: Plan, sessionId: string) => plan.weeks.filter((w) => w.sessions.some((s) => s.sessionId === sessionId)).map((w) => w.weekNo);

/** Ugen der vises: ?uge=, ellers denne uge, ellers den næste med sessionen, ellers den første. */
function pickWeek(plan: Plan, weeks: number[], wanted: number | undefined): number | undefined {
  if (wanted && weeks.includes(wanted)) return wanted;
  const now = weekForDate(plan, todayIso())?.weekNo ?? 0;
  return weeks.find((w) => w >= now) ?? weeks[0];
}

/** Et sikkert internt "tilbage"-link fra ?tilbage=. */
function backFrom(search: URLSearchParams): { href: string; label: string } {
  const href = search.get('tilbage');
  if (href?.startsWith('/') && !href.startsWith('//')) return { href, label: 'Tilbage' };
  return { href: '/indstillinger#plan', label: 'Indstillinger' };
}

/** /plan/<sessionId>?uge=<n>: ret en styrkesessions øvelser og gem som ny planversion. */
export function PlanEditPage() {
  const [, params] = useRoute('/plan/:sessionId');
  const search = new URLSearchParams(useSearch());
  const { active } = usePlan();
  const session = active?.plan.sessions.find((s) => s.id === params?.sessionId);
  const back = backFrom(search);

  if (!active) return <Screen title="Ret session" back={back}><Muted>Henter planen …</Muted></Screen>;
  if (!session || session.kind !== 'styrke')
    return (
      <Screen title="Ret session" back={back}>
        <Muted>Sessionen findes ikke i den aktive plan, eller den er ikke en styrkesession.</Muted>
      </Screen>
    );
  const weeks = scheduledWeeks(active.plan, session.id);
  const week = pickWeek(active.plan, weeks, Number(search.get('uge')) || undefined);
  if (!week)
    return (
      <Screen title={`Ret ${session.name}`} back={back}>
        <Muted>Sessionen står ikke i nogen uge i planen.</Muted>
      </Screen>
    );
  // Ny nøgle ved ny planversion eller uge: redigeringen starter forfra fra planen.
  return <Editor key={`${active.meta.version}-${week}`} plan={active.plan} version={active.meta.version} session={session} week={week} weeks={weeks} back={back} />;
}

type Editing = { slot: number; exercise: number };
type Picking = { kind: 'add' } | { kind: 'swap'; at: Editing };

function Editor({
  plan,
  version,
  session,
  week,
  weeks,
  back,
}: {
  plan: Plan;
  version: number;
  session: StrengthSession;
  week: number;
  weeks: number[];
  back: { href: string; label: string };
}) {
  const [, navigate] = useLocation();
  const { slug, refresh } = usePlan();
  const [drafts, setDrafts] = useState<DraftSlot[]>(() => draftFor(plan, session.id, week));
  /** Øvelser oprettet under redigeringen. Kun dem der bruges, kommer med i planen. */
  const [added, setAdded] = useState<Exercise[]>([]);
  const [scope, setScope] = useState<ScopeKind>('frem');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<Editing>();
  const [picking, setPicking] = useState<Picking>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const loggedIds = useLiveQuery(async () => (await db.set_logs.orderBy('exercise_id').uniqueKeys()) as string[], []);

  const catalog = useMemo(() => [...plan.exercises, ...added], [plan, added]);
  const base = useMemo(() => {
    const used = new Set(drafts.flatMap((d) => d.exercises.map((e) => e.exerciseId)));
    return { ...plan, exercises: [...plan.exercises, ...added.filter((e) => used.has(e.id))] };
  }, [plan, added, drafts]);
  const result = useMemo(() => applySessionEdit(base, session.id, week, scopeFor(plan, week, scope), drafts), [base, session.id, week, scope, drafts]);
  const diff = useMemo(() => {
    const lines = describePlanChange(plan, result);
    return lines.length === 1 && lines[0].startsWith('Ingen ændringer') ? [] : lines;
  }, [plan, result]);
  const dirty = diff.length > 0;
  const exerciseOf = (id: string) => catalog.find((e) => e.id === id);

  const weekIndex = weeks.indexOf(week);
  const goWeek = (w: number | undefined) => {
    if (!w || (dirty && !confirm('Skifte uge? Dine ændringer slettes.'))) return;
    navigate(`/plan/${session.id}?uge=${w}${back.label === 'Tilbage' ? `&tilbage=${encodeURIComponent(back.href)}` : ''}`, { replace: true });
  };

  const update = (at: Editing, patch: Partial<PlannedExercise>) =>
    setDrafts((ds) => ds.map((d, i) => (i !== at.slot ? d : { ...d, exercises: d.exercises.map((e, j) => (j === at.exercise ? { ...e, ...patch } : e)) })));
  const removeExercise = (at: Editing) =>
    setDrafts((ds) => ds.flatMap((d, i) => (i !== at.slot ? [d] : d.exercises.length > 1 ? [{ ...d, exercises: d.exercises.filter((_, j) => j !== at.exercise) }] : [])));
  const move = (i: number, by: -1 | 1) =>
    setDrafts((ds) => {
      const next = [...ds];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const planned = (exerciseId: string, keep?: PlannedExercise): PlannedExercise => {
    const ex = exerciseOf(exerciseId)!;
    const old = keep && exerciseOf(keep.exerciseId);
    // Samme type: behold doseringen, ellers den øvelsen har andre steder i planen.
    const dose = keep && old?.kind === ex.kind ? { ...keep.dose } : defaultDose(base, ex);
    return { exerciseId, dose };
  };
  function create(e: Omit<Exercise, 'id'>): string {
    const id = newExerciseId(e.name, [...catalog.map((x) => x.id), ...(loggedIds ?? [])]);
    setAdded((a) => [...a, { id, ...e }]);
    return id;
  }
  // Ny øvelse oprettet i vælgeren: katalog-staten er ikke opdateret endnu, så doseringen laves her.
  const plannedNew = (id: string, e: Omit<Exercise, 'id'>): PlannedExercise => ({ exerciseId: id, dose: defaultDose(base, { id, kind: e.kind }) });

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await savePlanEdit(slug, { baseVersion: version, note: note.trim() || undefined, plan: result });
      await refresh();
      navigate(back.href);
    } catch (e) {
      setError(e instanceof OfflineError ? 'Ingen forbindelse. Planen kan kun gemmes med net.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const current = editing && drafts[editing.slot]?.exercises[editing.exercise];
  const currentExercise = current && exerciseOf(current.exerciseId);
  const scopeText = scope === 'uge' ? `kun uge ${week}` : scope === 'frem' ? `uge ${week} og frem` : 'alle uger';
  const weekStart = plan.weeks.find((w) => w.weekNo === week)?.startDate;

  return (
    <Screen title={`Ret ${session.name}`} subtitle="Ændringerne bliver en ny planversion. Du kan altid rulle tilbage under Indstillinger → Plan." back={back}>
      <div className="mb-4 flex items-center justify-between gap-2 px-1">
        <SmallButton onClick={() => goWeek(weeks[weekIndex - 1])} disabled={weekIndex <= 0} aria-label="Forrige uge" className="px-3">
          <CaretLeft size={18} weight="bold" aria-hidden="true" />
        </SmallButton>
        <p className="num text-center text-headline">
          Uge {week}
          {weekStart && <span className="block text-footnote font-normal text-ink-2">fra {formatShort(weekStart)}</span>}
        </p>
        <SmallButton onClick={() => goWeek(weeks[weekIndex + 1])} disabled={weekIndex >= weeks.length - 1} aria-label="Næste uge" className="px-3">
          <CaretRight size={18} weight="bold" aria-hidden="true" />
        </SmallButton>
      </div>

      <Group title="Øvelser" description="Tryk på en øvelse for at rette dosering, bytte eller fjerne den.">
        {drafts.length === 0 && <Muted className="mb-3 px-1">Ingen øvelser i uge {week}. Tilføj mindst én.</Muted>}
        <ol className="inset-list overflow-hidden rounded-card bg-surface">
          {drafts.map((d, i) => (
            <li key={d.slotId ?? `ny-${i}`} className="flex items-stretch gap-1 pr-2">
              <div className="min-w-0 flex-1">
                {d.exercises.map((pe, j) => {
                  const ex = exerciseOf(pe.exerciseId);
                  const meta = ex ? [formatDose(ex, pe.dose), formatIntensity(pe.dose), `pause ${pe.dose.restSec} s`].filter(Boolean).join(' · ') : '';
                  return (
                    <button
                      key={`${pe.exerciseId}-${j}`}
                      type="button"
                      onClick={() => setEditing({ slot: i, exercise: j })}
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 active:bg-surface-2"
                    >
                      <span className="num w-5 shrink-0 text-secondary text-ink-2">{j === 0 ? `${i + 1}.` : ''}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-row">
                          {pe.label ?? ex?.name ?? pe.exerciseId}
                          {d.exercises.length > 1 && <span className="text-secondary text-ink-2"> · superset {j === 0 ? 'a' : 'b'}</span>}
                        </span>
                        <span className="num block text-secondary text-ink-2">{meta}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex shrink-0 flex-col justify-center">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Flyt ${i + 1} op`} className="grid size-11 place-items-center text-ink-2 disabled:opacity-25">
                  <ArrowUp size={18} weight="bold" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === drafts.length - 1} aria-label={`Flyt ${i + 1} ned`} className="grid size-11 place-items-center text-ink-2 disabled:opacity-25">
                  <ArrowDown size={18} weight="bold" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <SecondaryButton onClick={() => setPicking({ kind: 'add' })} className="mt-3">
          <Plus size={18} weight="bold" aria-hidden="true" /> Tilføj øvelse
        </SecondaryButton>
      </Group>

      <Group title="Gælder for" description="Uger, hvor planen har en anden dosering (fx deload) eller en anden øvelse på pladsen, beholder deres. Rækkefølgen gælder alle uger.">
        <Segmented
          label="Gælder for"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'uge', label: `Kun uge ${week}` },
            { value: 'frem', label: `Uge ${week} →` },
            { value: 'alle', label: 'Alle uger' },
          ]}
        />
      </Group>

      <Group title="Ændringer">
        {dirty ? (
          <ul className="inset-list overflow-hidden rounded-card bg-surface">
            {diff.slice(0, 12).map((line, i) => (
              <li key={i} className="num px-4 py-3 text-secondary">
                {line}
              </li>
            ))}
            {diff.length > 12 && <li className="px-4 py-3 text-secondary text-ink-2">+ {diff.length - 12} flere</li>}
          </ul>
        ) : (
          <Muted className="px-1">Ingen ændringer endnu.</Muted>
        )}
      </Group>

      <div className="flex flex-col gap-4 px-1">
        <TextField label="Note til versionen (valgfri)" placeholder="fx Flere sæt RDL" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        <ErrorText>{error}</ErrorText>
        <PrimaryButton onClick={() => void save()} disabled={!dirty || busy || drafts.length === 0}>
          {busy ? 'Gemmer …' : `Gem for ${scopeText}`}
        </PrimaryButton>
        {dirty && (
          <TextButton
            onClick={() => {
              setDrafts(draftFor(plan, session.id, week));
              setAdded([]);
            }}
            className="self-center"
          >
            Fortryd ændringerne
          </TextButton>
        )}
      </div>

      <Sheet open={!!current} onClose={() => setEditing(undefined)} title={current ? (current.label ?? currentExercise?.name ?? '') : ''}>
        {current && currentExercise && editing && (
          <>
            <DoseEditor exercise={currentExercise} dose={current.dose} onChange={(dose) => update(editing, { dose })} cue={current.cue} onCue={(cue) => update(editing, { cue })} />
            <div className="mt-6 flex flex-col gap-2">
              <SecondaryButton onClick={() => setPicking({ kind: 'swap', at: editing })}>Byt øvelse</SecondaryButton>
              <TextButton
                danger
                className="self-center"
                onClick={() => {
                  removeExercise(editing);
                  setEditing(undefined);
                }}
              >
                Fjern fra sessionen
              </TextButton>
            </div>
          </>
        )}
      </Sheet>

      <ExercisePicker
        open={!!picking}
        onClose={() => setPicking(undefined)}
        title={picking?.kind === 'swap' ? 'Byt til' : 'Tilføj øvelse'}
        catalog={catalog}
        exclude={picking?.kind === 'swap' && current ? [current.exerciseId] : []}
        onPick={(id) => {
          if (picking?.kind === 'swap') update(picking.at, { ...planned(id, current), label: undefined, cue: undefined, alternative: undefined });
          else setDrafts((ds) => [...ds, { slotId: null, exercises: [planned(id)] }]);
        }}
        onCreate={(e) => {
          const id = create(e);
          const pe = plannedNew(id, e);
          if (picking?.kind === 'swap') update(picking.at, { ...pe, label: undefined, cue: undefined, alternative: undefined });
          else setDrafts((ds) => [...ds, { slotId: null, exercises: [pe] }]);
        }}
      />
    </Screen>
  );
}
