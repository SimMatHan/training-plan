import { AthletePicker } from '../components/AthletePicker';
import { Screen } from '../components/Screen';
import { usePlan } from '../data/plan';

/** Vises mens planen hentes første gang, hvis den ikke kan hentes, eller hvis der ingen plan er endnu. */
export function PlanStatus({ title, picker = false }: { title: string; picker?: boolean }) {
  const { slug, loading, offline, error, none, refresh } = usePlan();
  return (
    <Screen title={title}>
      {picker && <AthletePicker value={slug} />}
      {none && !loading ? (
        <p className="text-muted">Ingen plan endnu. Den første plan kommer som et forslag fra Claude, som du godkender på I dag.</p>
      ) : loading ? (
        <p className="text-muted">Henter planen …</p>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted">
            {offline ? 'Ingen forbindelse, og planen er ikke hentet på denne enhed endnu.' : `Planen kunne ikke hentes: ${error}`}
          </p>
          <button type="button" onClick={() => void refresh()} className="min-h-12 rounded-lg border border-line px-4 font-medium">
            Prøv igen
          </button>
        </div>
      )}
    </Screen>
  );
}
