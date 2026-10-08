import { useEffect, useState } from 'react';
import { CALENDAR_TYPE_LABELS, CALENDAR_TYPES, DEFAULT_TIMED, type CalendarInfo, type CalendarSetting } from '../../shared/calendar';
import { kvGet, kvSet } from '../data/db';
import { usePlan } from '../data/plan';
import { athleteApi, OfflineError } from '../lib/api';
import { PrimaryButton, SecondaryButton, smallButton } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Group } from '../ui/InsetList';
import { ErrorText, Muted } from '../ui/Screen';
import { Segmented } from '../ui/Segmented';

const URL_KEY = 'calendarUrl';

type CalendarType = (typeof CALENDAR_TYPES)[number];

/**
 * Indstillinger → Kalender: abonnementslink, vejledning og tidspunkt pr. sessionstype.
 * Linkets token gemmes kun hashet på serveren, så URL'en vises, når linket laves, og huskes
 * derefter kun på denne enhed. "Lav nyt link" gør det gamle ugyldigt.
 */
export function CalendarSection() {
  const { slug } = usePlan();
  const [info, setInfo] = useState<CalendarInfo>();
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void kvGet<string>(URL_KEY).then((u) => u && setFeedUrl(u));
    athleteApi<CalendarInfo>(slug, '/calendar')
      .then(setInfo)
      .catch((e: Error) => setError(e instanceof OfflineError ? 'Offline — kalenderen kan sættes op, når der er net.' : e.message));
  }, [slug]);

  async function newLink() {
    if (info?.hasFeed && !confirm('Lav et nyt link? Det gamle holder op med at virke, og abonnementet skal tilføjes igen i kalenderen.')) return;
    setBusy(true);
    setError(undefined);
    try {
      const { feedUrl: url } = await athleteApi<{ feedUrl: string }>(slug, '/calendar/token', { method: 'POST' });
      setFeedUrl(url);
      setInfo((i) => i && { ...i, hasFeed: true });
      await kvSet(URL_KEY, url);
    } catch (e) {
      setError(e instanceof OfflineError ? 'Ingen forbindelse.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
      const saved = await athleteApi<CalendarSetting>(slug, `/calendar/settings/${encodeURIComponent(type)}`, { method: 'PUT', json: next });
      setInfo((i) => i && { ...i, settings: i.settings.map((s) => (s.session_type === type ? saved : s)) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Group title="Kalender">
      <Muted className="mb-3 px-1">
        Abonnér på træningsplanen i din kalender. Den opdaterer sig selv, når planen ændres, når du logger en session, og når du flytter en.
      </Muted>
      <ErrorText className="mb-3">{error}</ErrorText>
      {info && !feedUrl && (
        <Muted className="mb-3 px-1">
          {info.hasFeed
            ? 'Der er et abonnementslink, men det vises kun på enheden, hvor det blev lavet. Lav et nyt link for at se det her (det gamle holder så op med at virke).'
            : 'Der er ikke lavet et abonnementslink endnu.'}
        </Muted>
      )}
      {info &&
        (feedUrl ? (
          <SecondaryButton onClick={() => void newLink()} disabled={busy} className="mb-3">
            {busy ? 'Laver link …' : 'Lav nyt link'}
          </SecondaryButton>
        ) : (
          <PrimaryButton onClick={() => void newLink()} disabled={busy} className="mb-3">
            {busy ? 'Laver link …' : 'Lav nyt link'}
          </PrimaryButton>
        ))}
      {feedUrl && (
        <>
          <p className="num mb-2 rounded-card bg-surface p-4 text-secondary break-all select-all">{feedUrl}</p>
          <div className="mb-4 flex gap-2">
            <button type="button" onClick={() => void copy(feedUrl)} className={smallButton('secondary', 'flex-1')}>
              {copied ? 'Kopieret ✓' : 'Kopiér adresse'}
            </button>
            <a href={feedUrl.replace(/^https?:/, 'webcal:')} className={smallButton('secondary', 'flex-1')}>
              Abonnér
            </a>
          </div>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-footnote text-ink-2">
            <li>Kopiér adressen.</li>
            <li>
              På iPhone: <span className="text-ink">Indstillinger → Kalender → Konti → Tilføj konto → Andet → Tilføj kalender-abonnement</span>.
            </li>
            <li>Indsæt adressen og tryk Næste → Gem.</li>
          </ol>
          <p className="mb-4 px-1 text-footnote text-ink-2">
            Adressen er hemmelig: alle med den kan se planen. Kalenderen henter ændringer et par gange i døgnet. Lavede sessioner står på den dag, de blev
            lavet, med ✓.
          </p>
        </>
      )}
      {info && (
        <ul className="inset-list overflow-hidden rounded-card bg-surface">
          {info.settings
            .filter((s): s is CalendarSetting & { session_type: CalendarType } => (CALENDAR_TYPES as readonly string[]).includes(s.session_type))
            .map((s) => (
              <SettingRow key={s.session_type} setting={s} onSave={(next) => save(s.session_type, next)} />
            ))}
        </ul>
      )}
    </Group>
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
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-row">{CALENDAR_TYPE_LABELS[type]}</span>
        <Segmented
          className="w-48"
          label={`${CALENDAR_TYPE_LABELS[type]}: tidspunkt`}
          value={setting.all_day ? 'heldag' : 'tid'}
          onChange={(v) => {
            if (v === 'heldag' && !setting.all_day) void onSave({ all_day: true, start_time: setting.start_time, duration_min: setting.duration_min });
            if (v === 'tid' && setting.all_day) timed();
          }}
          options={[
            { value: 'heldag', label: 'Heldag' },
            { value: 'tid', label: 'Tidspunkt' },
          ]}
        />
      </div>
      {!setting.all_day && (
        <div className="mt-3 flex gap-3">
          <div className="flex-1">
            <TextField label="Start" type="time" value={start} onChange={(e) => setStart(e.target.value)} onBlur={() => timed()} />
          </div>
          <div className="flex-1">
            <TextField
              label="Varighed (min)"
              type="text"
              inputMode="numeric"
              enterKeyHint="done"
              value={duration}
              onChange={(e) => setDuration(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onBlur={() => timed()}
            />
          </div>
        </div>
      )}
    </li>
  );
}
