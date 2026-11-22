import { useEffect, useState } from 'react';
import { OfflineError } from '../lib/api';
import { currentPush, disablePush, enablePush, pushSupport, testPush } from '../lib/push';
import { SecondaryButton } from '../ui/Button';
import { Switch } from '../ui/Field';
import { Card, Group } from '../ui/InsetList';
import { ErrorText, Muted } from '../ui/Screen';
import { groupProps, SECTIONS } from './settingsSections';

const message = (e: unknown) => (e instanceof OfflineError ? 'Ingen forbindelse.' : (e as Error).message);

/** Indstillinger → Påmindelser: "Husk mobilitet" kl. 6 på dage uden styrketræning, på denne enhed. */
export function ReminderSection() {
  const support = pushSupport();
  const [on, setOn] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    if (support !== 'ok') return;
    currentPush()
      .then((s) => setOn(!!s))
      .catch(() => setOn(false));
  }, [support]);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      await (next ? enablePush() : disablePush());
      setOn(next);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError(undefined);
    try {
      await testPush();
      setStatus('Sendt. Den kommer om et øjeblik.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group {...groupProps(SECTIONS.paamindelser)}>
      {support === 'ok' ? (
        <>
          <Card className="mb-3">
            <Switch checked={!!on} onChange={(v) => !busy && on !== undefined && void toggle(v)} label="Husk mobilitet kl. 6" />
          </Card>
          {on && (
            <SecondaryButton onClick={() => void test()} disabled={busy}>
              Send en prøve nu
            </SecondaryButton>
          )}
          {status && (
            <p role="status" className="mt-2 px-1 text-footnote text-ink-2">
              {status}
            </p>
          )}
          <ErrorText className="mt-2 px-1">{error}</ErrorText>
        </>
      ) : support === 'hjemmeskaerm' ? (
        <Muted className="px-1">Føj appen til hjemmeskærmen (Del → Føj til hjemmeskærm) og åbn den derfra for at få påmindelser.</Muted>
      ) : (
        <Muted className="px-1">Denne browser kan ikke modtage påmindelser.</Muted>
      )}
    </Group>
  );
}
