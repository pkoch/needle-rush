import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { CLIENT_RELEASE } from '../lib/release';

type Player = { id: string; name: string; score: number };
type Fixture = {
  now: number;
  startsAt: number | null;
  phase: 'REVEAL' | 'FINISHED';
  players: Player[];
  revision: number;
  reads: number;
  liveClock?: boolean;
};
const BASE = 1_900_000_000_000;
const trio: Player[] = [
  { id: 'winner', name: 'Maya Headliner', score: 12 },
  { id: 'runner', name: 'Theo Encore', score: 7 },
  { id: 'last', name: 'Jules B Side', score: -3 },
];
const makeFixture = (players = trio): Fixture => ({ now: BASE, startsAt: BASE, phase: 'FINISHED', players: players.map(player => ({ ...player })), revision: 1, reads: 0 });

async function openFixture(browser: Browser, fixture: Fixture, mode: 'tv' | 'phone' = 'tv', options: { skew?: number; reducedMotion?: boolean } = {}): Promise<{ context: BrowserContext; page: Page; skew: number }> {
  const skew = options.skew ?? 0;
  const context = await browser.newContext({ viewport: mode === 'tv' ? { width: 1280, height: 720 } : { width: 390, height: 844 }, reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  await page.addInitScript(({ now, skew, phone, liveClock }) => {
    const global = window as unknown as { __fixtureNow: number; __fixtureHidden: boolean; __audioContexts: number };
    global.__fixtureNow = now + skew;
    global.__fixtureHidden = false;
    global.__audioContexts = 0;
    if (!liveClock) Date.now = () => global.__fixtureNow;
    if (phone) {
      localStorage.setItem('needle-room-player', 'ABC234');
      const Native = window.AudioContext;
      window.AudioContext = class extends Native { constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); global.__audioContexts++; } } as typeof AudioContext;
    }
  }, { now: fixture.now, skew, phone: mode === 'phone', liveClock: fixture.liveClock ?? false });
  await page.route('**/api/rooms', route => route.fulfill({ json: { code: 'ABC234' } }));
  await page.route('**/api/rooms/ABC234**', route => {
    if (route.request().method() !== 'GET') return route.fulfill({ json: { ok: true } });
    fixture.reads++;
    const now = fixture.liveClock ? Date.now() : fixture.now;
    if (fixture.liveClock && fixture.startsAt === null) fixture.startsAt = now;
    return route.fulfill({ json: {
      code: 'ABC234', release: CLIENT_RELEASE, phase: fixture.phase, revision: fixture.revision,
      scoredRounds: 10, serverTime: now, serverReceivedAt: now,
      finaleStartsAt: fixture.phase === 'FINISHED' ? fixture.startsAt : null,
      revealEndsAt: fixture.startsAt, preparation: null, displayReady: true,
      playerId: mode === 'phone' ? 'runner' : null, attempt: null, nextClip: null,
      players: fixture.players,
      round: { id: 'last-round', number: 10, opensAt: now - 30_000, closesAt: now - 1500, options: [0, 1, 2, 3].map(index => ({ id: String(index), title: `Track ${index}`, artist: `Artist ${index}` })), correctOptionId: '0' },
    } });
  });
  if (mode === 'tv') await page.request.get('/signin-with-chatgpt?return_to=/display');
  await page.goto(mode === 'tv' ? '/display' : '/join');
  await expect(page.locator('.room-panel')).not.toHaveAttribute('inert', '');
  // Hydration precedes the first room response. Wait for its clock offset and
  // snapshot to be applied before a test advances the synthetic client clock.
  await expect(page.locator('.room-panel')).toHaveAttribute('data-phase', fixture.phase);
  return { context, page, skew };
}

async function at(fixture: Fixture, pages: Array<{ page: Page; skew: number }>, elapsed: number) {
  fixture.now = BASE + elapsed;
  await Promise.all(pages.map(({ page, skew }) => page.evaluate(now => { (window as unknown as { __fixtureNow: number }).__fixtureNow = now; }, fixture.now + skew)));
  await Promise.all(pages.map(({ page }) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))));
}
async function featured(page: Page) {
  return page.locator('.finale-feature-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-feature-player-id')));
}

test('the final answer reveal and opening do not expose the final ranking', async ({ browser }) => {
  const fixture = makeFixture(); fixture.phase = 'REVEAL';
  const client = await openFixture(browser, fixture);
  await expect(client.page.locator('.finale-pending')).toBeVisible();
  await expect(client.page.locator('.standings')).toHaveCount(0);
  for (const player of trio) await expect(client.page.getByText(player.name, { exact: true })).toHaveCount(0);
  fixture.phase = 'FINISHED'; fixture.revision++;
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'opening');
  await expect(client.page.locator('.finale-feature-card,.finale-row')).toHaveCount(0);
  for (const player of trio) await expect(client.page.getByText(player.name, { exact: true })).toHaveCount(0);
  await expect(client.page.getByRole('button', { name: 'Start new game' })).toHaveCount(0);
  await at(fixture, [client], 1999);
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'opening');
  await client.context.close();
});

test('reveal order rises from the bottom; tied winners appear together and keep competition ranks', async ({ browser }) => {
  const fixture = makeFixture([
    { id: 'a', name: 'Maya Shared Crown', score: 14 }, { id: 'b', name: 'Theo Shared Crown', score: 14 },
    { id: 'c', name: 'Jules Third', score: 2 }, { id: 'd', name: 'Raf Fourth', score: -6 },
  ]);
  const client = await openFixture(browser, fixture);
  await at(fixture, [client], 2005); await expect.poll(() => featured(client.page)).toEqual(['d']);
  await expect(client.page.getByText('Maya Shared Crown', { exact: true })).toHaveCount(0);
  await at(fixture, [client], 2805); await expect.poll(() => featured(client.page)).toEqual(['c']);
  await expect(client.page.locator('.finale-row[data-player-id="d"] .finale-rank')).toHaveText('4');
  await at(fixture, [client], 4205); await expect.poll(() => featured(client.page)).toEqual(['a', 'b']);
  await expect(client.page.locator('.finale-feature-grid')).toHaveAttribute('data-count', '2');
  await expect(client.page.locator('.finale-feature-card .finale-rank')).toHaveText(['1st', '1st']);
  await at(fixture, [client], 6205); await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'settling');
  await expect(client.page.getByRole('button', { name: 'Start new game' })).toHaveCount(0);
  await at(fixture, [client], 7200); await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'complete');
  await expect(client.page.locator('.finale-row .finale-rank')).toHaveText(['1', '1', '3', '4']);
  await expect(client.page.locator('.finale-winner-banner h1')).toHaveText('Maya Shared Crown + Theo Shared Crown');
  await expect(client.page.getByRole('button', { name: 'Start new game' })).toBeVisible();
  await client.context.close();
});

test('repeated polls cannot replace the frozen final snapshot or restart the ceremony', async ({ browser }) => {
  const fixture = makeFixture();
  const client = await openFixture(browser, fixture);
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'opening');
  fixture.players = fixture.players.map(player => ({ ...player, name: `Changed ${player.id}`, score: -player.score })); fixture.revision++;
  await expect.poll(() => fixture.reads).toBeGreaterThanOrEqual(3);
  await at(fixture, [client], 2005); await expect.poll(() => featured(client.page)).toEqual(['last']);
  await expect(client.page.locator('.finale-feature-card')).toContainText('Jules B Side');
  await at(fixture, [client], 5005); await expect.poll(() => featured(client.page)).toEqual(['winner']);
  await expect(client.page.locator('.finale-feature-card')).toContainText('Maya Headliner');
  await at(fixture, [client], 8000); await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'complete');
  await expect(client.page.locator('.finale-row .finale-player-name')).toHaveText(['Maya Headliner', 'Theo Encore', 'Jules B Side']);
  await client.page.waitForTimeout(450);
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'complete');
  await client.context.close();
});

test('an all-tied room takes five real seconds and holds Start new game until completion', async ({ browser }) => {
  const fixture = makeFixture(Array.from({ length: 16 }, (_, index) => ({ id: `p${index}`, name: `Shared Legend ${index + 1}`, score: -1 })));
  fixture.liveClock = true; fixture.startsAt = null; fixture.now = Date.now();
  const client = await openFixture(browser, fixture);
  await client.page.evaluate(() => {
    const global = window as unknown as { __completeAt?: number };
    const observer = new MutationObserver(() => { if (document.querySelector('.finale-scene')?.getAttribute('data-stage') === 'complete' && !global.__completeAt) global.__completeAt = Date.now(); });
    observer.observe(document.documentElement, { subtree: true, attributes: true });
  });
  await expect(client.page.getByRole('button', { name: 'Start new game' })).toHaveCount(0);
  await expect(client.page.locator('.finale-feature-card')).toHaveCount(16, { timeout: 4000 });
  await expect(client.page.locator('.finale-feature-grid')).toHaveAttribute('data-dense', 'true');
  await expect(client.page.getByRole('button', { name: 'Start new game' })).toHaveCount(0);
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'complete', { timeout: 4500 });
  const completedAt = await client.page.evaluate(() => (window as unknown as { __completeAt: number }).__completeAt);
  // Scheduling is exact in the pure timeline tests; this tolerance covers clock synchronization RTT.
  expect(completedAt - fixture.startsAt!).toBeGreaterThanOrEqual(4970);
  expect(completedAt - fixture.startsAt!).toBeLessThan(5400);
  await expect(client.page.locator('.finale-row')).toHaveCount(16);
  await expect(client.page.locator('.finale-row .finale-rank')).toHaveText(Array(16).fill('1'));
  await expect(client.page.getByRole('button', { name: 'Start new game' })).toBeVisible();
  await client.context.close();
});

test('missing timing data renders usable complete results immediately', async ({ browser }) => {
  const fixture = makeFixture(); fixture.startsAt = null;
  const client = await openFixture(browser, fixture);
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'complete');
  await expect(client.page.locator('.finale-row')).toHaveCount(3);
  await expect(client.page.getByRole('button', { name: 'Start new game' })).toBeVisible();
  await client.context.close();
});

test('a disconnected finished phone can reconnect by clearing its saved room and returning to join', async ({ browser }) => {
  const fixture = makeFixture(); fixture.startsAt = null;
  const client = await openFixture(browser, fixture, 'phone');
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'complete');
  await expect(client.page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  expect(await client.page.evaluate(() => localStorage.getItem('needle-room-player'))).toBe('ABC234');
  await client.page.route('**/api/rooms/ABC234**', route => route.fulfill({ status: 401, json: { error: 'Please rejoin this room.' } }));
  const reconnect = client.page.getByRole('button', { name: 'Reconnect', exact: true });
  await expect(reconnect).toBeVisible();
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'complete');
  await reconnect.click();
  await expect(client.page.locator('.join-form')).toBeVisible();
  await expect(client.page.getByLabel('Room code')).toHaveValue('');
  await expect(client.page.locator('.finale-scene')).toHaveCount(0);
  await expect(reconnect).toHaveCount(0);
  expect(await client.page.evaluate(() => localStorage.getItem('needle-room-player'))).toBeNull();
  await client.context.close();
});

test('late arrival and background recovery catch up without replaying the opening or old groups', async ({ browser }) => {
  const fixture = makeFixture(); fixture.now = BASE + 5500;
  const client = await openFixture(browser, fixture);
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'reveal');
  await expect.poll(() => featured(client.page)).toEqual(['winner']);
  await expect(client.page.locator('.finale-row')).toHaveCount(2);
  await expect(client.page.locator('.finale-opening')).toHaveCount(0);
  await client.page.evaluate(() => {
    const global = window as unknown as { __fixtureHidden: boolean };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => global.__fixtureHidden ? 'hidden' : 'visible' });
    global.__fixtureHidden = true; document.dispatchEvent(new Event('visibilitychange'));
  });
  await at(fixture, [client], 12_000);
  await client.page.evaluate(() => { (window as unknown as { __fixtureHidden: boolean }).__fixtureHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'complete');
  await expect(client.page.locator('.finale-row')).toHaveCount(3);
  await expect(client.page.locator('.finale-opening,.finale-feature-card')).toHaveCount(0);
  await client.context.close();
});

test('TV and phone reveal the same placements despite opposite local clock skew; phones stay silent', async ({ browser }) => {
  const fixture = makeFixture();
  const tv = await openFixture(browser, fixture, 'tv', { skew: 45_000 });
  const phone = await openFixture(browser, fixture, 'phone', { skew: -30_000 });
  await at(fixture, [tv, phone], 2200);
  await expect.poll(() => featured(tv.page)).toEqual(['last']); await expect.poll(() => featured(phone.page)).toEqual(['last']);
  await at(fixture, [tv, phone], 3700);
  await expect.poll(() => featured(tv.page)).toEqual(['runner']); await expect.poll(() => featured(phone.page)).toEqual(['runner']);
  await expect(phone.page.locator('.finale-feature-card[data-you="true"] .finale-you-tag')).toHaveText('YOU');
  await at(fixture, [tv, phone], 5500);
  await expect.poll(() => featured(tv.page)).toEqual(['winner']); await expect.poll(() => featured(phone.page)).toEqual(['winner']);
  await at(fixture, [tv, phone], 8000);
  await expect(phone.page.locator('.finale-scene')).toHaveAttribute('data-stage', 'complete');
  await expect(phone.page.getByRole('button', { name: 'Start new game' })).toHaveCount(0);
  expect(await phone.page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts)).toBe(0);
  expect(await phone.page.locator('audio,video').count()).toBe(0);
  await tv.context.close(); await phone.context.close();
});

test('reduced motion keeps sequence timing while removing travel and confetti', async ({ browser }) => {
  const fixture = makeFixture();
  const client = await openFixture(browser, fixture, 'tv', { reducedMotion: true });
  await expect(client.page.locator('.finale-scene')).toHaveAttribute('data-reduced-motion', 'true');
  await at(fixture, [client], 2050);
  await expect.poll(() => featured(client.page)).toEqual(['last']);
  const transforms = await client.page.locator('.finale-feature-card').evaluateAll(cards => cards.flatMap(card => card.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.transform).filter(Boolean))));
  expect(transforms.length).toBeGreaterThan(0); expect(transforms.every(transform => transform === 'none')).toBeTruthy();
  await at(fixture, [client], 5050); await expect.poll(() => featured(client.page)).toEqual(['winner']);
  await expect(client.page.locator('.finale-confetti')).toHaveCount(0);
  await at(fixture, [client], 7999); await expect(client.page.getByRole('button', { name: 'Start new game' })).toHaveCount(0);
  await at(fixture, [client], 8000); await expect(client.page.getByRole('button', { name: 'Start new game' })).toBeVisible();
  await client.context.close();
});
