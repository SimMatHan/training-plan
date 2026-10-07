import { Screen } from '../components/Screen';
import { usePlan } from '../data/plan';

/** Vises mens planen hentes første gang, eller hvis den ikke kan hentes. */
export function PlanStatus({ title }: { title: string }) {
  const { loading, offline, error, refresh } = usePlan();
  return (
    <Screen title={title}>
      {loading ? (
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
