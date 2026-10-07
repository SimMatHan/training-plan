// Planens struktur. Én plan-JSON = én række i plan_versions.plan_json.
// Skemaet deles af seed-scriptet, Worker'en og frontenden.
import { z } from 'zod';

/** Stabil slug: små bogstaver, tal og bindestreg. Må aldrig ændres for en øvelse. */
export const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Ugyldigt id (slug)');

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dato skal være YYYY-MM-DD');

/** Lukket interval af uger, fx { from: 5, to: 8 }. */
export const WeekRange = z
  .object({ from: z.int().min(1), to: z.int().min(1) })
  .refine((r) => r.to >= r.from, 'Ugeinterval: to < from');
export type WeekRange = z.infer<typeof WeekRange>;

/** Talinterval. Et fast tal skrives som { min: 8, max: 8 }. */
export const NumRange = z
  .object({ min: z.number().nonnegative(), max: z.number().nonnegative() })
  .refine((r) => r.max >= r.min, 'Interval: max < min');
export type NumRange = z.infer<typeof NumRange>;

export const Side = z.enum(['H', 'V']);
export type Side = z.infer<typeof Side>;

// ─── Øvelser ────────────────────────────────────────────────────────────────

/**
 * Øvelsestyper der logges i sæt. Løb og cardio er sessionstyper (se Session),
 * mobilitet er en tjekliste (se MobilityBlock).
 */
export const ExerciseKind = z.enum(['weight_reps', 'bodyweight_reps', 'time']);
export type ExerciseKind = z.infer<typeof ExerciseKind>;

export const Exercise = z.object({
  /** Stabilt id. Al loghistorik knyttes hertil. */
  id: Slug,
  name: z.string().min(1),
  kind: ExerciseKind,
  /** Unilateral: logges som separate rækker for højre og venstre. */
  perSide: z.boolean(),
  focus: z.string().optional(),
});
export type Exercise = z.infer<typeof Exercise>;

// ─── Dosering ───────────────────────────────────────────────────────────────

export const Intensity = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rpe'), min: z.number().min(1).max(10), max: z.number().min(1).max(10) }),
  z.object({ kind: z.literal('pct1rm'), min: z.number().min(1).max(100), max: z.number().min(1).max(100) }),
]);
export type Intensity = z.infer<typeof Intensity>;

/** Afvigende dosis for én side (fx venstre 3 × 10 når højre er 3 × 12). */
export const SideOverride = z.object({
  sets: z.int().min(1).optional(),
  reps: NumRange.optional(),
  seconds: NumRange.optional(),
});

export const Dose = z.object({
  sets: z.int().min(1),
  /** Ekstra sæt der må tages (fx "2–3 sæt" = sets 2, optionalSets 1). */
  optionalSets: z.int().min(0).default(0),
  /** Reps pr. sæt (pr. side ved unilaterale øvelser). Bruges af *_reps-typer. */
  reps: NumRange.optional(),
  /** Sekunder pr. sæt (pr. side). Bruges af time-typen. */
  seconds: NumRange.optional(),
  intensity: Intensity.optional(),
  restSec: z.int().min(0),
  /** Tempo eller udførelseskrav, fx "3 sek ned" eller "3 sek hver vej". */
  tempo: z.string().optional(),
  /** Note til netop denne dosering, fx "Halv kraft". */
  note: z.string().optional(),
  /** Unilaterale øvelser: rækkefølge af sider. Første side tages først. */
  sideOrder: z.array(Side).length(2).optional(),
  /** alternate: H1, V1, H2, V2 …  block: alle sæt på første side, derefter anden side. */
  sidePattern: z.enum(['alternate', 'block']).optional(),
  /** Afvigende dosis pr. side. */
  sideOverrides: z.partialRecord(Side, SideOverride).optional(),
});
export type Dose = z.infer<typeof Dose>;

export const PlannedExercise = z.object({
  exerciseId: Slug,
  /** Visningsnavn i netop denne session, hvis det afviger fra katalogets navn. */
  label: z.string().optional(),
  dose: Dose,
  /** Udførelse og note fra planen. */
  cue: z.string().optional(),
  /** Alternativ øvelse planen nævner eksplicit, med betingelse. */
  alternative: z
    .object({
      exerciseId: Slug,
      label: z.string().optional(),
      condition: z.string().min(1),
      dose: Dose,
    })
    .optional(),
});
export type PlannedExercise = z.infer<typeof PlannedExercise>;

/**
 * Én variant af en plads i sessionen, gyldig i bestemte uger.
 * 1 øvelse = enkeltøvelse, 2 øvelser = superset.
 * Rotation og ændret dosering udtrykkes som flere varianter på samme plads.
 */
export const SlotVariant = z.object({
  weeks: z.array(WeekRange).min(1),
  exercises: z.array(PlannedExercise).min(1).max(2),
});
export type SlotVariant = z.infer<typeof SlotVariant>;

export const SessionSlot = z.object({
  /** Stabilt id for pladsen, fx "styrke-a-1". */
  id: Slug,
  order: z.int().min(1),
  focus: z.string().optional(),
  variants: z.array(SlotVariant).min(1),
});
export type SessionSlot = z.infer<typeof SessionSlot>;

// ─── Sessioner ──────────────────────────────────────────────────────────────

/** Farvenøgle: A = rød, B = blå, run = gul, mobility = grøn. */
export const ColorKey = z.enum(['A', 'B', 'run', 'mobility']);

const SessionBase = z.object({
  id: Slug,
  name: z.string().min(1),
  colorKey: ColorKey,
  /** 1 = mandag … 7 = søndag. */
  suggestedWeekday: z.int().min(1).max(7).optional(),
  durationMin: NumRange.optional(),
  notes: z.array(z.string()).default([]),
});

export const StrengthSession = SessionBase.extend({
  kind: z.literal('styrke'),
  intro: z.string().optional(),
  mobility: z.enum(['before', 'after', 'none']),
  slots: z.array(SessionSlot).min(1),
  /** Planens progressionstabel som tekst, til visning og til Claude. */
  progression: z
    .array(z.object({ weeks: WeekRange, sets: z.string(), rpe: z.string(), note: z.string() }))
    .default([]),
});
export type StrengthSession = z.infer<typeof StrengthSession>;

export const RunSession = SessionBase.extend({
  kind: z.enum(['løb', 'cardio']),
  /** Planens kode, fx "T1", "L1+", "CT". */
  code: z.string().optional(),
  workoutType: z.string(),
  mainSet: z.string(),
  rest: z.string().optional(),
  targetPace: z.string().optional(),
  totalApprox: z.string().optional(),
  purpose: z.string().optional(),
  warmup: z.string().optional(),
});
export type RunSession = z.infer<typeof RunSession>;

export const MobilitySession = SessionBase.extend({
  kind: z.literal('mobilitet'),
});

export const Session = z.discriminatedUnion('kind', [StrengthSession, RunSession, MobilitySession]);
export type Session = z.infer<typeof Session>;

// ─── Mobilitet ──────────────────────────────────────────────────────────────

export const MobilityItem = z.object({
  id: Slug,
  name: z.string(),
  dose: z.string(),
  target: z.string().optional(),
  cue: z.string().optional(),
});
export type MobilityItem = z.infer<typeof MobilityItem>;

export const MobilityBlock = z.object({
  name: z.string(),
  durationMin: NumRange.optional(),
  intro: z.string().optional(),
  items: z.array(MobilityItem).min(1),
  measurement: z.object({
    instructions: z.string(),
    /** Uger hvor knæ-til-væg måles ifølge planen. */
    weeks: z.array(z.int().min(1)),
    /** Påmindelse når der er gået så mange dage siden sidste måling. */
    reminderDays: z.int().min(1),
  }),
  notes: z.array(z.string()).default([]),
});

// ─── Uger ───────────────────────────────────────────────────────────────────

export const ScheduledSession = z.object({
  sessionId: Slug,
  /** 1 = mandag … 7 = søndag. Foreslået dag; sessioner kan tages andre dage i ugen. */
  day: z.int().min(1).max(7),
  /** Teksten fra ugeplanen, fx "RH (5 km) — kun hvis snurren er væk". */
  label: z.string(),
  optional: z.boolean().default(false),
  targetKm: NumRange.optional(),
  targetMin: NumRange.optional(),
  condition: z.string().optional(),
});
export type ScheduledSession = z.infer<typeof ScheduledSession>;

export const Week = z.object({
  weekNo: z.int().min(1),
  /** Mandag i ugen. */
  startDate: IsoDate,
  phase: z.string(),
  focus: z.string().optional(),
  kmLabel: z.string().optional(),
  sessions: z.array(ScheduledSession),
});
export type Week = z.infer<typeof Week>;

// ─── Plan ───────────────────────────────────────────────────────────────────

export const TrafficLightRule = z.object({
  color: z.enum(['grøn', 'gul', 'rød']),
  signal: z.string(),
  action: z.string(),
});

export const PlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string(),
    summary: z.string().optional(),
    startDate: IsoDate,
    raceDate: IsoDate,
    readingNotes: z.array(z.string()).default([]),
    exercises: z.array(Exercise).min(1),
    sessions: z.array(Session).min(1),
    mobility: MobilityBlock,
    weeks: z.array(Week).min(1),
    groin: z.object({
      side: z.literal('V'),
      rules: z.array(TrafficLightRule),
      gate: z.string().optional(),
    }),
    runNotes: z.array(z.string()).default([]),
  })
  .superRefine((plan, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });

    const exercises = new Map(plan.exercises.map((e) => [e.id, e]));
    if (exercises.size !== plan.exercises.length) issue('Dubletter blandt exercise-id');

    const sessions = new Map(plan.sessions.map((s) => [s.id, s]));
    if (sessions.size !== plan.sessions.length) issue('Dubletter blandt session-id');

    const itemIds = new Set(plan.mobility.items.map((i) => i.id));
    if (itemIds.size !== plan.mobility.items.length) issue('Dubletter blandt mobilitets-id');

    const checkPlanned = (pe: { exerciseId: string; dose: Dose }, path: (string | number)[]) => {
      const ex = exercises.get(pe.exerciseId);
      if (!ex) return issue(`Ukendt øvelse: ${pe.exerciseId}`, path);
      const d = pe.dose;
      if (ex.kind === 'time' && !d.seconds) issue(`${ex.id}: tidsøvelse uden seconds`, path);
      if (ex.kind !== 'time' && !d.reps) issue(`${ex.id}: repsøvelse uden reps`, path);
      if (!ex.perSide && (d.sideOrder || d.sidePattern || d.sideOverrides))
        issue(`${ex.id}: sidefelter på en bilateral øvelse`, path);
    };

    plan.sessions.forEach((s, si) => {
      if (s.kind !== 'styrke') return;
      const slotIds = new Set<string>();
      s.slots.forEach((slot, sli) => {
        if (slotIds.has(slot.id)) issue(`Dublet slot-id ${slot.id}`, ['sessions', si, 'slots', sli]);
        slotIds.add(slot.id);
        slot.variants.forEach((v, vi) =>
          v.exercises.forEach((pe, pi) => {
            const path = ['sessions', si, 'slots', sli, 'variants', vi, 'exercises', pi];
            checkPlanned(pe, path);
            if (pe.alternative) checkPlanned(pe.alternative, [...path, 'alternative']);
          }),
        );
      });
    });

    const weekNos = new Set<number>();
    const start = Date.parse(plan.startDate);
    plan.weeks.forEach((w, wi) => {
      if (weekNos.has(w.weekNo)) issue(`Dublet uge ${w.weekNo}`, ['weeks', wi]);
      weekNos.add(w.weekNo);
      if (new Date(w.startDate + 'T00:00:00Z').getUTCDay() !== 1) issue(`Uge ${w.weekNo} starter ikke en mandag`, ['weeks', wi]);
      if (Date.parse(w.startDate) < start) issue(`Uge ${w.weekNo} ligger før planens start`, ['weeks', wi]);

      const seen = new Set<string>();
      w.sessions.forEach((ss, ssi) => {
        const path = ['weeks', wi, 'sessions', ssi];
        if (seen.has(ss.sessionId)) issue(`Session ${ss.sessionId} står to gange i uge ${w.weekNo}`, path);
        seen.add(ss.sessionId);
        const session = sessions.get(ss.sessionId);
        if (!session) return issue(`Ukendt session: ${ss.sessionId}`, path);
        if (session.kind !== 'styrke') return;
        // Hver plads må højst have én variant der dækker ugen, og mindst én plads skal være aktiv.
        let active = 0;
        for (const slot of session.slots) {
          const n = slot.variants.filter((v) => v.weeks.some((r) => w.weekNo >= r.from && w.weekNo <= r.to)).length;
          if (n > 1) issue(`${slot.id}: ${n} varianter dækker uge ${w.weekNo}`, path);
          active += n;
        }
        if (active === 0) issue(`${session.id} har ingen øvelser i uge ${w.weekNo}`, path);
      });
    });
  });

export type Plan = z.infer<typeof PlanSchema>;
