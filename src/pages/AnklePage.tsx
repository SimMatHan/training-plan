import { useState, type FormEvent } from 'react';
import { measurementDue } from '../../shared/mobility';
import { AnkleChart } from '../components/AnkleChart';
import { NoteField } from '../components/NoteField';
import { NumberField } from '../components/NumberField';
import { Screen, Section } from '../components/Screen';
import { saveMeasurement, useMobilityPoints } from '../data/health';
import { usePlan } from '../data/plan';
import { formatShort, formatWithYear, todayIso } from '../lib/dates';
import { formatDecimal } from '../logic/numbers';

export function AnklePage() {
  const points = useMobilityPoints() ?? [];
  const { active } = usePlan();
  const [right, setRight] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const measurement = active?.plan.mobility.measurement;
  const { due, days } = measurementDue(points, todayIso(), measurement?.reminderDays ?? 14);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (right == null || left == null) return;
    await saveMeasurement({ date: todayIso(), right, left, note });
    setRight(null);
    setLeft(null);
    setNote(null);
    setSaved(true);
  }

  return (
    <Screen title="Ankel" eyebrow="Knæ-til-væg, højre achilles">
      <Section title="Forskel mellem siderne">
        <p className="mb-3 text-sm text-muted">Venstre minus højre i cm. Målet er 0: højre når venstre.</p>
        <AnkleChart points={points} />
      </Section>

      <Section title={due ? 'Mål i dag' : 'Ny måling'}>
        {!due && days != null && (
          <p className="mb-3 text-sm text-muted">
            {days === 0 ? 'Målt i dag.' : days === 1 ? 'Målt i går.' : `Sidst målt for ${days} dage siden.`} Næste påmindelse efter {measurement?.reminderDays} dage.
          </p>
        )}
        {measurement && <p className="mb-3 text-sm text-muted">{measurement.instructions}</p>}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-muted">
              Højre (cm)
              <NumberField decimal label="Højre, cm" value={right} placeholder={points.length ? formatDecimal(points.at(-1)!.right) : ''} onValue={setRight} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              Venstre (cm)
              <NumberField decimal label="Venstre, cm" value={left} placeholder={points.length ? formatDecimal(points.at(-1)!.left) : ''} onValue={setLeft} />
            </label>
          </div>
          <NoteField label="Kommentar" value={note} onSave={setNote} />
          <button type="submit" disabled={right == null || left == null} className="min-h-14 rounded-lg bg-fg text-lg font-semibold text-bg disabled:opacity-40">
            Gem måling
          </button>
          {saved && (
            <p role="status" className="text-sm text-mob-ink">
              Målingen er gemt.
            </p>
          )}
        </form>
      </Section>

      <Section title="Alle målinger">
        <table className="num w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-normal">Dato</th>
              <th className="py-1 text-right font-normal">Højre</th>
              <th className="py-1 text-right font-normal">Venstre</th>
              <th className="py-1 text-right font-normal">Forskel</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-y border-line">
            {[...points].reverse().map((p) => (
              <tr key={p.uuid}>
                <td className="py-2" title={formatWithYear(p.date)}>
                  {formatShort(p.date)}
                  {p.note && <span className="block text-xs text-muted">{p.note}</span>}
                </td>
                <td className="py-2 text-right">{formatDecimal(p.right)}</td>
                <td className="py-2 text-right">{formatDecimal(p.left)}</td>
                <td className="py-2 text-right font-semibold">{formatDecimal(p.diff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </Screen>
  );
}
