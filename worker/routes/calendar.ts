import { Hono } from 'hono';
import type { CalendarInfo } from '../../shared/calendar';
import { appOrigin, ownerOnly } from '../auth';
import type { AppEnv } from '../env';
import { ValidationError } from '../services/errors';
import {
  buildCalendarFeed,
  CalendarSettingInput,
  CalendarType,
  getCalendarSettings,
  hasCalendarToken,
  rotateCalendarToken,
  setCalendarSetting,
  verifyCalendarToken,
} from '../services/calendar';

/** /api/a/:slug/calendar: indstillinger og nyt abonnementslink (kun atleten selv). */
export const calendarRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { athleteId } = ownerOnly(c);
    return c.json<CalendarInfo>({ hasFeed: await hasCalendarToken(c.env.DB, athleteId), settings: await getCalendarSettings(c.env.DB, athleteId) });
  })
  // Nyt link: det gamle holder straks op med at virke. Tokenet gemmes kun hashet, så URL'en vises kun her.
  .post('/token', async (c) => {
    const { athleteId, athlete } = ownerOnly(c);
    const token = await rotateCalendarToken(c.env.DB, athleteId);
    return c.json({ feedUrl: `${appOrigin(c.env, c.req.url)}/cal/${athlete.slug}/${token}.ics` });
  })
  .put('/settings/:type', async (c) => {
    const { athleteId } = ownerOnly(c);
    const type = CalendarType.safeParse(c.req.param('type'));
    if (!type.success) throw new ValidationError(`Ukendt sessionstype: ${c.req.param('type')}`);
    return c.json(await setCalendarSetting(c.env.DB, athleteId, type.data, CalendarSettingInput.parse(await c.req.json())));
  });

/**
 * GET /cal/:slug/:token.ics — feedet kalenderapps abonnerer på. Tokenet står i URL'en og er
 * pr. atlet (hashet i D1). Forkert atlet, token eller format giver 404, så URL'en ikke afslører,
 * at der findes et feed.
 */
export const feedRoutes = new Hono<AppEnv>()
  .get('/cal/:slug/:file', async (c) => {
    const file = c.req.param('file');
    if (!file.endsWith('.ics')) return c.notFound();
    const athleteId = await verifyCalendarToken(c.env.DB, c.req.param('slug'), file.slice(0, -4));
    if (!athleteId) return c.notFound();
    const ics = await buildCalendarFeed(c.env.DB, athleteId, { origin: appOrigin(c.env, c.req.url) });
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
