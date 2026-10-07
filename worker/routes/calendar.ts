import { Hono } from 'hono';
import type { CalendarInfo } from '../../shared/calendar';
import { safeEqual } from '../auth';
import type { AppEnv } from '../env';
import { ValidationError } from '../services/errors';
import { buildCalendarFeed, CalendarSettingInput, CalendarType, getCalendarSettings, setCalendarSetting } from '../services/calendar';

const origin = (url: string) => new URL(url).origin;

/** Abonnements-URL'en. Den indeholder CAL_TOKEN og vises kun bag API-tokenet. */
export const feedUrl = (url: string, token: string | undefined) => (token ? `${origin(url)}/cal/${encodeURIComponent(token)}.ics` : null);

/** /api/calendar: abonnements-URL og indstillinger (kræver API-tokenet). */
export const calendarRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json<CalendarInfo>({ feedUrl: feedUrl(c.req.url, c.env.CAL_TOKEN), settings: await getCalendarSettings(c.env.DB) }))
  .put('/settings/:type', async (c) => {
    const type = CalendarType.safeParse(c.req.param('type'));
    if (!type.success) throw new ValidationError(`Ukendt sessionstype: ${c.req.param('type')}`);
    return c.json(await setCalendarSetting(c.env.DB, type.data, CalendarSettingInput.parse(await c.req.json())));
  });

/**
 * GET /cal/:token.ics — feedet kalenderapps abonnerer på. Tokenet står i URL'en og er
 * derfor sin egen secret (CAL_TOKEN), ikke API_TOKEN. Forkert eller manglende token giver
 * 404, så URL'en ikke afslører, at der findes et feed.
 */
export const feedRoutes = new Hono<AppEnv>()
  .get('/cal/:file', async (c) => {
    const file = c.req.param('file');
    const expected = c.env.CAL_TOKEN;
    if (!expected || !file.endsWith('.ics') || !(await safeEqual(file.slice(0, -4), expected))) return c.notFound();
    const ics = await buildCalendarFeed(c.env.DB, { origin: origin(c.req.url) });
    return c.body(ics, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'max-age=900',
      'Content-Disposition': 'inline; filename="traeningsplan.ics"',
    });
  })
  .notFound((c) => c.text('Ikke fundet', 404))
  .onError((err, c) => {
    console.error(err);
    return c.text('Kalenderen kunne ikke genereres', 500);
  });
