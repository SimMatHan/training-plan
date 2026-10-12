// Sektionerne i Indstillinger: titel, ikon og en kort forklaring. Bruges både af sektionernes
// overskrifter og af oversigten øverst, så de altid stemmer overens.
import { CalendarBlank, ClipboardText, Database, DeviceMobile, Heartbeat, LockKey, Sparkle, UserCircle, UserPlus, Users, type Icon } from '@phosphor-icons/react';

export interface SettingsSection {
  id: string;
  title: string;
  icon: Icon;
  description: string;
}

const section = (id: string, title: string, icon: Icon, description: string): SettingsSection => ({ id, title, icon, description });

export const SECTIONS = {
  konto: section('konto', 'Konto', UserCircle, 'Hvem der er logget ind på denne telefon.'),
  plan: section('plan', 'Plan', ClipboardText, 'Den aktive planversion. Du kan skifte tilbage til en tidligere; loghistorikken bevares.'),
  overvaagning: section(
    'overvaagning',
    'Overvågning',
    Heartbeat,
    'Smerte-monitors får en score efter hver træning og et spørgsmål morgenen efter (trafiklys). Mobilitetstests minder dig om en ny måling efter 14 dage.',
  ),
  deling: section('deling', 'Deling', Users, 'En træner kan se din uge, historik og Claudes forslag og bruge Claude til at lave dit program. Kun du kan logge og godkende forslag.'),
  kalender: section('kalender', 'Kalender', CalendarBlank, 'Abonnér på træningsplanen i din kalender. Den opdaterer sig selv, når planen ændres, når du logger en session, og når du flytter en.'),
  claude: section('claude', 'Claude', Sparkle, 'Én forbindelse pr. atlet, så Claude aldrig blander jeres data.'),
  sikkerhed: section('sikkerhed', 'Sikkerhed', LockKey, 'Du logger ind med en passkey (Face ID). Passkeys fra iCloud-nøgleringen virker på alle dine Apple-enheder.'),
  brugere: section('brugere', 'Brugere', UserPlus, 'Invitér nye brugere, eller giv en eksisterende bruger en ny passkey.'),
  data: section('data', 'Data', Database, 'Alle dine træninger, sæt, noter, smerte- og mobilitetsmålinger samt planversioner som én JSON-fil.'),
  app: section('app', 'App', DeviceMobile, 'Version og opdateringer.'),
} satisfies Record<string, SettingsSection>;

/** Props til <Group> for en sektion. */
export const groupProps = (s: SettingsSection) => ({ id: s.id, title: s.title, icon: s.icon, description: s.description });
