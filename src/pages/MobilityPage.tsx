import { useState, type FormEvent } from 'react';
import type { MobilityTest } from '../../shared/athletes';
import { measurementDue, type MobilityPoint } from '../../shared/mobility';
import { MobilityChart, useReminderDays } from '../components/MobilityCards';
import { NoteField } from '../components/NoteField';
import { NumberField } from '../components/NumberField';
import { Screen, Section } from '../components/Screen';
import { saveMeasurement, useMobilityTrends } from '../data/health';
import { useMobilityTests } from '../data/plan';
import { formatShort, formatWithYear, todayIso } from '../lib/dates';
import { formatDecimal } from '../logic/numbers';

/** Mobilitetstests (fx knee-to-wall): udvikling, ny måling og alle målinger. */
export function MobilityPage() {
  const tests = useMobilityTests();
  const trends = useMobilityTrends(tests) ?? [];
  return (
    <Screen title="Mobilitet" eyebrow="Tests og målinger">
      {tests.length === 0 && <p className="text-muted">Ingen mobilitetstests endnu. De tilføjes under Indstillinger → Overvågning, eller som forslag fra Claude.</p>}
      {trends.map(({ test, points }) => (
        <TestSection key={test.id} test={test} points={points} />
      ))}
    </Screen>
  );
}

function TestSection({ test, points }: { test: MobilityTest; points: MobilityPoint[] }) {
  const reminderDays = useReminderDays();
  const [right, setRight] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { due, days } = measurementDue(points, todayIso(), reminderDays);
  const last = points.at(-1);
  const ready = test.per_side ? right != null && left != null : value != null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    await saveMeasurement({ testId: test.id, date: todayIso(), right: test.per_side ? right : null, left: test.per_side ? left : null, value: test.per_side ? null : value, note });
    setRight(null);
    setLeft(null);
    setValue(null);
    setNote(null);
    setSaved(true);
  }

  return (
    <div id={`test-${test.id}`} className="mb-4 scroll-mt-4">
      <h2 className="mb-3 text-2xl">{test.name}</h2>
      {points.length > 0 && (
        <Section title={test.per_side ? 'Forskel mellem siderne' : 'Udvikling'}>
          {test.per_side && <p className="mb-3 text-sm text-muted">Venstre minus højre i {test.unit}. Målet er 0.</p>}
          <MobilityChart test={test} points={points} />
        </Section>
      )}

      <Section title={due ? 'Mål i dag' : 'Ny måling'}>
        {!due && days != null && (
          <p className="mb-3 text-sm text-muted">
            {days === 0 ? 'Målt i dag.' : days === 1 ? 'Målt i går.' : `Sidst målt for ${days} dage siden.`} Næste påmindelse efter {reminderDays} dage.
          </p>
        )}
        {test.instructions && <p className="mb-3 text-sm text-muted">{test.instructions}</p>}
        <form onSubmit={submit} className="flex flex-col gap-3">
          {test.per_side ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm text-muted">
                Højre ({test.unit})
                <NumberField decimal label={`Højre, ${test.unit}`} value={right} placeholder={last ? formatDecimal(last.right) : ''} onValue={setRight} />
              </label>
              <label className="flex flex-col gap-1 text-sm text-muted">
                Venstre ({test.unit})
                <NumberField decimal label={`Venstre, ${test.unit}`} value={left} placeholder={last ? formatDecimal(last.left) : ''} onValue={setLeft} />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-1 text-sm text-muted">
              Resultat ({test.unit})
              <NumberField decimal label={`${test.name}, ${test.unit}`} value={value} placeholder={last ? formatDecimal(last.value) : ''} onValue={setValue} />
            </label>
          )}
          <NoteField label="Kommentar" value={note} onSave={setNote} />
          <button type="submit" disabled={!ready} className="min-h-14 rounded-lg bg-fg text-lg font-semibold text-bg disabled:opacity-40">
            Gem måling
          </button>
          {saved && (
            <p role="status" className="text-sm text-mob-ink">
              Målingen er gemt.
            </p>
          )}
        </form>
      </Section>

      {points.length > 0 && (
        <Section title="Alle målinger">
          <table className="num w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-normal">Dato</th>
                {test.per_side ? (
                  <>
                    <th className="py-1 text-right font-normal">Højre</th>
                    <th className="py-1 text-right font-normal">Venstre</th>
                    <th className="py-1 text-right font-normal">Forskel</th>
                  </>
                ) : (
                  <th className="py-1 text-right font-normal">{test.unit}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-y border-line">
              {[...points].reverse().map((p) => (
                <tr key={p.uuid}>
                  <td className="py-2" title={formatWithYear(p.date)}>
                    {formatShort(p.date)}
                    {p.note && <span className="block text-xs text-muted">{p.note}</span>}
                  </td>
                  {test.per_side ? (
                    <>
                      <td className="py-2 text-right">{formatDecimal(p.right)}</td>
                      <td className="py-2 text-right">{formatDecimal(p.left)}</td>
                      <td className="py-2 text-right font-semibold">{formatDecimal(p.diff)}</td>
                    </>
                  ) : (
                    <td className="py-2 text-right font-semibold">{formatDecimal(p.value)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
