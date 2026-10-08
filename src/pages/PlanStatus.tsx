import { AthletePicker } from '../components/AthletePicker';
import { SecondaryButton } from '../ui/Button';
import { Muted, Screen } from '../ui/Screen';
import { usePlan } from '../data/plan';

/** Vises mens planen hentes første gang, hvis den ikke kan hentes, eller hvis der ingen plan er endnu. */
export function PlanStatus({ title, picker = false }: { title: string; picker?: boolean }) {
  const { slug, loading, offline, error, none, refresh } = usePlan();
  return (
    <Screen title={title}>
      {picker && <AthletePicker value={slug} />}
      {none && !loading ? (
        <Muted>Ingen plan endnu. Den første plan kommer som et forslag fra Claude, som du godkender på I dag.</Muted>
      ) : loading ? (
        <Muted>Henter planen …</Muted>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <Muted>
            {offline ? 'Ingen forbindelse, og planen er ikke hentet på denne enhed endnu.' : `Planen kunne ikke hentes: ${error}`}
          </Muted>
          <SecondaryButton onClick={() => void refresh()}>Prøv igen</SecondaryButton>
        </div>
      )}
    </Screen>
  );
}
