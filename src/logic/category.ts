// Kategori for en øvelse eller session: styrer ikonflisens ikon og farve.
// Kategorien udledes af planens fokusområde (pladsens `focus`, ellers øvelsens), og
// falder tilbage på øvelsens navn.
import type { Plan, Session } from '../../shared/plan.schema';

export type Category = 'legs' | 'back' | 'arms' | 'core' | 'calf' | 'mobility' | 'cardio';

export const CATEGORY_LABEL: Record<Category, string> = {
  legs: 'Ben og hofte',
  back: 'Ryg og træk',
  arms: 'Skuldre og arme',
  core: 'Core',
  calf: 'Læg og ankel',
  mobility: 'Mobilitet',
  cardio: 'Løb og cardio',
};

// Rækkefølgen betyder noget: "Baglår, ryg" er ben, "Core, hofte" er core.
const RULES: [Category, RegExp][] = [
  ['mobility', /mobilitet|stræk/],
  ['cardio', /løb|cardio|cykl|svøm/],
  ['calf', /achilles|soleus|læg|ankel|tåhæv/],
  ['core', /core|sideplank|pallof|mave/],
  ['legs', /baglår|\bben\b|hofte|lyske|balder|psoas|adduktor|knæ|squat|dødløft|rdl|hamstring|leg curl|step-down|hip /],
  ['arms', /skuld|arm|biceps|triceps|curl|pres/],
  ['back', /ryg|lats|træk|postur|row|pulldown|pull-up|face pull|y-t/],
];

function classify(text: string | undefined): Category | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  return RULES.find(([, re]) => re.test(t))?.[0];
}

/** Kategori fra et fokusområde og evt. øvelsens navn. Ukendt: ben og hofte. */
export const categoryOf = (focus: string | undefined, name?: string): Category => classify(focus) ?? classify(name) ?? 'legs';

/** Kategori for en øvelse: øvelsens eget fokus, ellers fokus på den første plads, den står på. */
export function exerciseCategory(plan: Plan | undefined, exerciseId: string): Category {
  const exercise = plan?.exercises.find((e) => e.id === exerciseId);
  let slotFocus: string | undefined;
  for (const s of plan?.sessions ?? []) {
    if (s.kind !== 'styrke') continue;
    const slot = s.slots.find((sl) => sl.variants.some((v) => v.exercises.some((e) => e.exerciseId === exerciseId || e.alternative?.exerciseId === exerciseId)));
    if (slot?.focus) {
      slotFocus = slot.focus;
      break;
    }
  }
  return categoryOf(exercise?.focus ?? slotFocus, exercise?.name ?? exerciseId);
}

/** Kategori for en hel session: løb og mobilitet efter type, styrke A som ben, B som ryg. */
export function sessionCategory(session: Pick<Session, 'kind' | 'colorKey'>): Category {
  if (session.kind === 'løb' || session.kind === 'cardio') return 'cardio';
  if (session.kind === 'mobilitet') return 'mobility';
  return session.colorKey === 'B' ? 'back' : 'legs';
}
