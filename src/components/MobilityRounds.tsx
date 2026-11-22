import type { MobilityRound, Plan } from '../../shared/plan.schema';
import { setRoundCheck, useRoundChecks } from '../data/workouts';
import { isComplete, mobilityProgress } from '../logic/progress';
import { MobilityBlockCard } from './MobilityChecklist';

const ROUND_TITLE: Record<MobilityRound, string> = { morgen: 'Morgen', aften: 'Aften' };

/**
 * Mobilitetsrunderne på I dag, når planen har mobility.schedule (fx morgen og aften): én tjekliste pr.
 * runde, uden for sessionerne. Den første runde, der ikke er lavet, står åben. Morgenrunden kan også
 * krydses af som opvarmning i en styrkesession; det er de samme afkrydsninger.
 */
export function MobilityRounds({ plan, date }: { plan: Plan; date: string }) {
  const checks = useRoundChecks(date);
  const rounds = plan.mobility?.schedule;
  if (!plan.mobility || !rounds || !checks) return null;
  const progress = rounds.map((round) => mobilityProgress(plan, checks.filter((c) => c.round === round)));
  const first = progress.findIndex((p) => !isComplete(p));
  return (
    <section aria-label={plan.mobility.name} className="mb-10 flex flex-col gap-3">
      {rounds.map((round, i) => (
        <MobilityBlockCard
          key={round}
          plan={plan}
          title={ROUND_TITLE[round]}
          kicker={plan.mobility!.name}
          checks={checks.filter((c) => c.round === round)}
          onToggle={(itemId, done) => void setRoundCheck(date, round, itemId, done)}
          progress={progress[i]}
          defaultOpen={i === first}
        />
      ))}
    </section>
  );
}
