import { useState, type FormEvent } from 'react';
import type { MobilityTest } from '../../shared/athletes';
import { measurementDue, type MobilityPoint } from '../../shared/mobility';
import { MobilityChart, useReminderDays } from '../components/MobilityCards';
import { NoteField } from '../components/NoteField';
import { NumberField } from '../components/NumberField';
import { PrimaryButton } from '../ui/Button';
import { Card, Group } from '../ui/InsetList';
import { Muted, Screen } from '../ui/Screen';
import { saveMeasurement, useMobilityTrends } from '../data/health';
import { useMobilityTests } from '../data/plan';
import { formatShort, formatWithYear, todayIso } from '../lib/dates';
import { formatDecimal } from '../logic/numbers';

/** Mobilitetstests (fx knee-to-wall): udvikling, ny måling og alle målinger. */
export function MobilityPage() {
  const tests = useMobilityTests();
  const trends = useMobilityTrends(tests) ?? [];
  return (
    <Screen title="Mobilitet" subtitle="Tests og målinger" back={{ href: '/', label: 'I dag' }}>
      {tests.length === 0 && <Muted>Ingen mobilitetstests endnu. De tilføjes under Indstillinger → Overvågning, eller som forslag fra Claude.</Muted>}
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
    <div id={`test-${test.id}`} className="mb-4 scroll-mt-16">
      <h2 className="mb-4 px-1 text-title">{test.name}</h2>
      {points.length > 0 && (
        <Group small title={test.per_side ? 'Forskel mellem siderne' : 'Udvikling'}>
          {test.per_side && <Muted className="mb-3 px-1">Venstre minus højre i {test.unit}. Målet er 0.</Muted>}
          <Card>
            <MobilityChart test={test} points={points} />
          </Card>
        </Group>
      )}

      <Group small title={due ? 'Mål i dag' : 'Ny måling'}>
        {!due && days != null && (
          <p className="mb-3 px-1 text-secondary text-ink-2">
            {days === 0 ? 'Målt i dag.' : days === 1 ? 'Målt i går.' : `Sidst målt for ${days} dage siden.`} Næste påmindelse efter {reminderDays} dage.
          </p>
        )}
        {test.instructions && <Muted className="mb-3 px-1">{test.instructions}</Muted>}
        <form onSubmit={submit} className="flex flex-col gap-4 rounded-card bg-surface p-4">
          {test.per_side ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-footnote text-ink-2">
                Højre ({test.unit})
                <NumberField decimal label={`Højre, ${test.unit}`} value={right} placeholder={last ? formatDecimal(last.right) : ''} onValue={setRight} />
              </label>
              <label className="flex flex-col gap-1.5 text-footnote text-ink-2">
                Venstre ({test.unit})
                <NumberField decimal label={`Venstre, ${test.unit}`} value={left} placeholder={last ? formatDecimal(last.left) : ''} onValue={setLeft} />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-1.5 text-footnote text-ink-2">
              Resultat ({test.unit})
              <NumberField decimal label={`${test.name}, ${test.unit}`} value={value} placeholder={last ? formatDecimal(last.value) : ''} onValue={setValue} />
            </label>
          )}
          <NoteField label="Kommentar" value={note} onSave={setNote} />
          <PrimaryButton type="submit" disabled={!ready}>
            Gem måling
          </PrimaryButton>
          {saved && (
            <p role="status" className="text-secondary text-ink">
              Målingen er gemt.
            </p>
          )}
        </form>
      </Group>

      {points.length > 0 && (
        <Group small title="Alle målinger">
          <table className="num w-full overflow-hidden rounded-card bg-surface text-left text-secondary">
            <thead className="text-footnote text-ink-2">
              <tr>
                <th className="py-2 pl-4 font-normal">Dato</th>
                {test.per_side ? (
                  <>
                    <th className="py-2 pr-4 text-right font-normal">Højre</th>
                    <th className="py-2 pr-4 text-right font-normal">Venstre</th>
                    <th className="py-2 pr-4 text-right font-normal">Forskel</th>
                  </>
                ) : (
                  <th className="py-2 pr-4 text-right font-normal">{test.unit}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y-[0.5px] divide-separator border-t-[0.5px] border-separator">
              {[...points].reverse().map((p) => (
                <tr key={p.uuid}>
                  <td className="py-2.5 pl-4" title={formatWithYear(p.date)}>
                    {formatShort(p.date)}
                    {p.note && <span className="block text-footnote text-ink-2">{p.note}</span>}
                  </td>
                  {test.per_side ? (
                    <>
                      <td className="py-2.5 pr-4 text-right">{formatDecimal(p.right)}</td>
                      <td className="py-2.5 pr-4 text-right">{formatDecimal(p.left)}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold">{formatDecimal(p.diff)}</td>
                    </>
                  ) : (
                    <td className="py-2.5 pr-4 text-right font-semibold">{formatDecimal(p.value)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      )}
    </div>
  );
}
