import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { Exercise, ExerciseKind } from '../../shared/plan.schema';
import { KIND_LABEL } from '../../shared/planEdit';
import { PrimaryButton } from '../ui/Button';
import { Switch, TextField, fieldClass } from '../ui/Field';
import { InsetList, InsetRow, RowText } from '../ui/InsetList';
import { Segmented } from '../ui/Segmented';
import { Muted } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';

const KINDS: { value: ExerciseKind; label: string }[] = [
  { value: 'weight_reps', label: 'Vægt' },
  { value: 'bodyweight_reps', label: 'Kropsvægt' },
  { value: 'time', label: 'Tid' },
];

/**
 * Vælg en øvelse fra planens katalog, eller opret en ny (navn, type og om den tages pr. side).
 * `onCreate` får den nye øvelses felter; id'et laves af den, der kalder.
 */
export function ExercisePicker({
  open,
  onClose,
  title,
  catalog,
  exclude = [],
  onPick,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  catalog: Exercise[];
  exclude?: string[];
  onPick: (exerciseId: string) => void;
  onCreate?: (e: Omit<Exercise, 'id'>) => void;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ExerciseKind>('weight_reps');
  const [perSide, setPerSide] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((e) => !exclude.includes(e.id) && (!q || e.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'da'));
  }, [catalog, exclude, query]);

  const close = () => {
    setQuery('');
    setCreating(false);
    setName('');
    onClose();
  };
  const taken = catalog.some((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase());

  return (
    <Sheet open={open} onClose={close} title={title}>
      {creating ? (
        <div className="flex flex-col gap-4">
          <TextField label="Navn" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="fx Goblet squat" maxLength={60} />
          {taken && <p className="-mt-2 text-footnote text-ink-2">Der findes allerede en øvelse med det navn i planen.</p>}
          <div>
            <p className="mb-1.5 text-footnote text-ink-2">Logges som</p>
            <Segmented label="Logges som" options={KINDS} value={kind} onChange={setKind} />
          </div>
          <Switch label="Én side ad gangen (højre og venstre)" checked={perSide} onChange={setPerSide} />
          <Muted>Typen og siderne kan ikke ændres bagefter, fordi historikken hænger på øvelsen.</Muted>
          <PrimaryButton
            disabled={!name.trim() || taken}
            onClick={() => {
              onCreate?.({ name: name.trim(), kind, perSide });
              close();
            }}
          >
            Opret øvelse
          </PrimaryButton>
        </div>
      ) : (
        <>
          <div className="relative mb-4">
            <MagnifyingGlass size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-2" aria-hidden="true" />
            <input type="search" aria-label="Søg i øvelser" placeholder="Søg" value={query} onChange={(e) => setQuery(e.target.value)} className={`${fieldClass} pl-9`} />
          </div>
          {onCreate && (
            <InsetList className="mb-4">
              <InsetRow
                onClick={() => {
                  setName(query.trim());
                  setCreating(true);
                }}
                chevron={false}
              >
                <Plus size={20} weight="bold" className="text-brand-red" aria-hidden="true" />
                <RowText title="Ny øvelse" detail={query.trim() ? `“${query.trim()}”` : 'Ikke i planen endnu'} />
              </InsetRow>
            </InsetList>
          )}
          {list.length ? (
            <InsetList label="Øvelser i planen">
              {list.map((e) => (
                <InsetRow
                  key={e.id}
                  onClick={() => {
                    onPick(e.id);
                    close();
                  }}
                >
                  <RowText title={e.name} detail={`${KIND_LABEL[e.kind]}${e.perSide ? ' · pr. side' : ''}`} />
                </InsetRow>
              ))}
            </InsetList>
          ) : (
            <Muted className="px-1">Ingen øvelser matcher.</Muted>
          )}
        </>
      )}
    </Sheet>
  );
}
