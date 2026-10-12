// /dev/figurer: alle øvelsesillustrationer med start- og slutstilling. Kun i dev-build.
import { ILLUSTRATIONS } from '../logic/illustrations';
import { Figure } from './Figure';

export default function DevFigures() {
  // ?vis=rdl,sideplanke viser kun de øvelser, i én kolonne og større.
  const only = new URLSearchParams(location.search).get('vis')?.split(',');
  const entries = Object.entries(ILLUSTRATIONS).filter(([id]) => !only || only.includes(id));
  return (
    <main className="bg-bg p-4 text-ink">
      <h1 className="mb-4 text-large-title">Figurer</h1>
      <div className={`grid gap-3 ${only ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {entries.map(([id, ill]) => (
          <section key={id} className="rounded-card bg-surface p-2">
            <h2 className="mb-1 truncate text-footnote font-semibold">{id}</h2>
            <div className="grid grid-cols-2">
              <Figure illustration={ill} frame={0} label={`${id} start`} />
              <Figure illustration={ill} frame={1} label={`${id} slut`} />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
