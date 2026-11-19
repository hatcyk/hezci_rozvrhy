// Nastavení upozornění, které server neuloží (429 z limitu zápisů, výpadek):
// přepínač se vrátí do uloženého stavu a toast řekne česky, že se změna
// neuložila. Dřív zůstal přepnutý a uživatel si myslel, že je uloženo.
const { test, expect } = require('./support/fixtures');

const LIMIT = { error: 'Příliš mnoho změn nastavení upozornění, zkuste to později.', retryAfterSec: 300 };
const NOT_SAVED = /Změna nastavení upozornění se neuložila/;

/** Sledovaný rozvrh, jak ho vrací GET /api/fcm/preferences. */
const watched = (scheduleType) => ({
  type: 'Class', id: 'C2A', name: '2.A', scheduleType, groupFilters: [],
  notificationTypes: {
    changes: { lesson_removed: true, substitution: true, room_change: true, lesson_added: false, subject_change: false },
    reminders: { next_lesson_room: false, next_lesson_teacher: false, next_lesson_subject: false },
  },
});

test.describe('Nastavení upozornění, které se neuloží', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'zvonek je na počítači; na mobilu se panel otevírá z nabídky');
  });

  /** Odpovědi serveru na čtení a zápis předvoleb; zápis vrací `save`. */
  async function server(page, { preferences = null, save }) {
    const writes = [];
    await page.route('**/api/fcm/preferences/*', (route) => (preferences
      ? route.fulfill({ json: preferences })
      : route.fulfill({ status: 404, json: { error: 'v e2e testu není' } })));
    await page.route('**/api/fcm/update-preferences', (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill(save);
    });
    return writes;
  }

  async function openSheet(page, app) {
    await app.open('/');
    await app.timetableReady();
    await page.click('#notificationBell');
    await expect(page.locator('#notificationModal')).toHaveAttribute('open', '');
    await page.getByRole('button', { name: /^Třídy/ }).click();
  }

  test('výběr rozvrhu ke sledování (429): přepínač se vrátí, toast řekne proč', async ({ page, app }) => {
    const writes = await server(page, { save: { status: 429, json: LIMIT, headers: { 'Retry-After': '300' } } });
    await openSheet(page, app);
    const toggle = page.getByRole('switch', { name: 'Sledovat 2.A' });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    const toast = page.locator('.toast').filter({ hasText: NOT_SAVED });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Příliš mnoho změn nastavení upozornění, zkuste to později. Znovu to půjde zhruba za 5 min.');
    expect(writes).toHaveLength(1);
    await expect(toggle).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Nastavení upozornění: 2.A' })).toBeHidden();
    // ani stav aplikace si nemyslí, že se rozvrh sleduje: tlačítko Zapnout bez výběru nejde
    await expect(page.locator('#notificationToggleEnable')).toBeDisabled();
    await expect(page.locator('#flatTimetableList .flat-accordion-count').first()).toBeHidden();
  });

  test('přepínač druhu upozornění (výpadek serveru): vrátí se a toast řekne, že se změna neuložila', async ({ page, app }) => {
    const writes = await server(page, {
      preferences: { watchedTimetables: [watched('Actual'), watched('Next')], notificationsEnabled: false, hasTokens: false },
      save: { status: 503, contentType: 'text/html', body: '<html>Service Unavailable</html>' },
    });
    await openSheet(page, app);
    await expect(page.getByRole('switch', { name: 'Sledovat 2.A' })).toBeChecked();
    await page.getByRole('button', { name: 'Nastavení upozornění: 2.A' }).click();
    await page.locator('#notifPreferencesContainer').getByRole('button', { name: /Aktuální/ }).click();
    const substitution = page.locator('#notifPreferencesContainer').getByRole('switch', { name: /Suplování/ }).first();
    await expect(substitution).toBeChecked();
    await substitution.click();
    const toast = page.locator('.toast').filter({ hasText: NOT_SAVED });
    await expect(toast).toBeVisible();
    await expect(toast).not.toContainText(/Failed|Server refused/);
    expect(writes).toHaveLength(1);
    expect(writes[0].watchedTimetables[0].notificationTypes.changes.substitution, 'odeslaná změna').toBe(false);
    await expect(substitution, 'vrácený přepínač').toBeChecked();
  });

  test('uložení, které projde, toast neukáže a přepínač zůstane', async ({ page, app }) => {
    const writes = await server(page, { save: { json: { success: true } } });
    await openSheet(page, app);
    const toggle = page.getByRole('switch', { name: 'Sledovat 2.A' });
    await toggle.click();
    await expect.poll(() => writes.length).toBe(1);
    await expect(toggle).toBeChecked();
    await expect(page.locator('.toast').filter({ hasText: NOT_SAVED })).toHaveCount(0);
    await expect(page.locator('#notificationToggleEnable')).toBeEnabled();
  });
});
