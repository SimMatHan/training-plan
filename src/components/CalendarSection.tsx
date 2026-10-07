import { useEffect, useState } from 'react';
import { CALENDAR_TYPE_LABELS, CALENDAR_TYPES, DEFAULT_TIMED, type CalendarInfo, type CalendarSetting } from '../../shared/calendar';
import { api, OfflineError } from '../lib/api';
import { Section } from './Screen';

type CalendarType = (typeof CALENDAR_TYPES)[number];

/** Indstillinger → Kalender: abonnements-URL, vejledning og tidspunkt pr. sessionstype. */
export function CalendarSection() {
  const [info, setInfo] = useState<CalendarInfo>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<CalendarInfo>('/calendar')
      .then(setInfo)
      .catch((e: Error) => setError(e instanceof OfflineError ? 'Offline — kalenderen kan sættes op, når der er net.' : e.message));
  }, []);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Kunne ikke kopiere. Markér adressen og kopiér den manuelt.');
    }
  }

  async function save(type: CalendarType, next: Pick<CalendarSetting, 'all_day' | 'start_time' | 'duration_min'>) {
    setError(undefined);
    try {
      const saved = await api<CalendarSetting>(`/calendar/settings/${encodeURIComponent(type)}`, { method: 'PUT', json: next });
      setInfo((i) => i && { ...i, settings: i.settings.map((s) => (s.session_type === type ? saved : s)) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Section title="Kalender">
      <p className="mb-3 text-sm text-muted">
        Abonnér på træningsplanen i din kalender. Den opdaterer sig selv, når planen ændres, når du logger en session, og når du flytter en.
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-a-ink">
          {error}
        </p>
      )}
      {info && !info.feedUrl && <p className="mb-3 text-sm text-muted">Kalenderfeedet er ikke slået til: CAL_TOKEN er ikke sat på serveren (se README).</p>}
      {info?.feedUrl && (
        <>
          <p className="num mb-2 rounded-lg border border-line bg-surface p-3 text-sm break-all select-all">{info.feedUrl}</p>
          <div className="mb-3 flex gap-2">
            <button type="button" onClick={() => void copy(info.feedUrl!)} className="min-h-12 flex-1 rounded-lg bg-fg px-4 font-semibold text-bg">
              {copied ? 'Kopieret ✓' : 'Kopiér adresse'}
            </button>
            <a href={info.feedUrl.replace(/^https?:/, 'webcal:')} className="flex min-h-12 flex-1 items-center justify-center rounded-lg border border-line px-4 font-medium">
              Abonnér
            </a>
          </div>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Kopiér adressen.</li>
            <li>
              På iPhone: <span className="text-fg">Indstillinger → Kalender → Konti → Tilføj konto → Andet → Tilføj kalender-abonnement</span>.
            </li>
            <li>Indsæt adressen og tryk Næste → Gem.</li>
          </ol>
          <p className="mb-4 text-sm text-muted">
            Adressen er hemmelig: alle med den kan se planen. Kalenderen henter ændringer et par gange i døgnet. Lavede sessioner står på den dag, de blev
            lavet, med ✓.
          </p>
        </>
      )}
      {info && (
        <ul className="divide-y divide-line border-y border-line">
          {info.settings
            .filter((s): s is CalendarSetting & { session_type: CalendarType } => (CALENDAR_TYPES as readonly string[]).includes(s.session_type))
            .map((s) => (
              <SettingRow key={s.session_type} setting={s} onSave={(next) => save(s.session_type, next)} />
            ))}
        </ul>
      )}
    </Section>
  );
}

function SettingRow({
  setting,
  onSave,
}: {
  setting: CalendarSetting & { session_type: CalendarType };
  onSave: (next: Pick<CalendarSetting, 'all_day' | 'start_time' | 'duration_min'>) => Promise<void>;
}) {
  const type = setting.session_type;
  const fallback = DEFAULT_TIMED[type];
  const [start, setStart] = useState(setting.start_time ?? fallback.start_time);
  const [duration, setDuration] = useState(String(setting.duration_min ?? fallback.duration_min));

  const timed = (startTime = start, durationText = duration) => {
    const minutes = Number(durationText);
    if (!/^\d{2}:\d{2}$/.test(startTime) || !Number.isInteger(minutes) || minutes < 5 || minutes > 600) return;
    if (!setting.all_day && startTime === setting.start_time && minutes === setting.duration_min) return;
    void onSave({ all_day: false, start_time: startTime, duration_min: minutes });
  };

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{CALENDAR_TYPE_LABELS[type]}</span>
        <div role="group" aria-label={`${CALENDAR_TYPE_LABELS[type]}: tidspunkt`} className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            aria-pressed={setting.all_day}
            onClick={() => !setting.all_day && void onSave({ all_day: true, start_time: setting.start_time, duration_min: setting.duration_min })}
            className={`min-h-12 rounded-lg px-3 text-sm font-medium ${setting.all_day ? 'bg-fg text-bg' : 'border border-line'}`}
          >
            Heldag
          </button>
          <button
            type="button"
            aria-pressed={!setting.all_day}
            onClick={() => setting.all_day && timed()}
            className={`min-h-12 rounded-lg px-3 text-sm font-medium ${!setting.all_day ? 'bg-fg text-bg' : 'border border-line'}`}
          >
            Tidspunkt
          </button>
        </div>
      </div>
      {!setting.all_day && (
        <div className="mt-2 flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm text-muted">
            Start
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onBlur={() => timed()}
              className="num min-h-12 rounded-lg border border-line bg-raised px-3 text-base text-fg"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm text-muted">
            Varighed (min)
            <input
              type="text"
              inputMode="numeric"
              enterKeyHint="done"
              value={duration}
              onChange={(e) => setDuration(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onBlur={() => timed()}
              className="num min-h-12 rounded-lg border border-line bg-raised px-3 text-base text-fg"
            />
          </label>
        </div>
      )}
    </li>
  );
}
