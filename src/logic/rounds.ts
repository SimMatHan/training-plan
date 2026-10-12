// Runder: en ensidig øvelse logges som standard som "sæt 1, 2, 3" for begge sider på én gang.
// Hver runde skriver de samme tal til både højre og venstre, så datamodellen (en række pr. side)
// og historikken er uændret. Forskellige tal pr. side slås til med en kontakt.
import type { ExerciseKind, Side } from '../../shared/plan.schema';
import type { SetLog } from '../../shared/records.schema';
import { formatRange, type SetRow } from '../../shared/resolve';

export interface Round {
  setNo: number;
  /** Sætrækkerne i runden, én pr. side (eller én uden side). */
  rows: SetRow[];
  /** Valgfri, hvis alle sider er valgfri i runden. */
  optional: boolean;
}

/** Sætrækker grupperet pr. sætnummer, i den rækkefølge de første gang optræder. */
export function toRounds(rows: SetRow[]): Round[] {
  const rounds: Round[] = [];
  for (const row of rows) {
    const round = rounds.find((r) => r.setNo === row.setNo);
    if (round) round.rows.push(row);
    else rounds.push({ setNo: row.setNo, rows: [row], optional: row.optional });
  }
  for (const r of rounds) r.optional = r.rows.every((x) => x.optional);
  return rounds;
}

const SIDE_LETTER: Record<Side, string> = { H: 'H', V: 'V' };

/** Målet for en runde: "12 reps", eller "12 H / 10 V reps" når siderne har forskelligt mål. */
export function roundTarget(round: Round, kind: ExerciseKind): string {
  const unit = kind === 'time' ? ' sek' : ' reps';
  const targets = round.rows.map((r) => formatRange(kind === 'time' ? r.seconds : r.reps));
  if (targets.every((t) => t === targets[0])) return `${targets[0]}${unit}`;
  return `${round.rows.map((r, i) => `${targets[i]} ${r.side ? SIDE_LETTER[r.side] : ''}`.trim()).join(' / ')}${unit}`;
}

type Values = Pick<SetLog, 'weight_kg' | 'reps' | 'seconds'>;

/**
 * Om dagens log har forskellige tal på de to sider i samme sæt. Så vises siderne hver for sig,
 * så intet logget skjules.
 */
export function sidesDiffer(logs: (Pick<SetLog, 'set_no' | 'side'> & Values)[]): boolean {
  const bySet = new Map<number, Values[]>();
  for (const l of logs) if (l.side) bySet.set(l.set_no, [...(bySet.get(l.set_no) ?? []), l]);
  for (const values of bySet.values()) {
    const [a, ...rest] = values;
    if (rest.some((b) => b.weight_kg !== a.weight_kg || b.reps !== a.reps || b.seconds !== a.seconds)) return true;
  }
  return false;
}
