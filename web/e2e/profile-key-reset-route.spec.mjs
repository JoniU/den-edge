// A compound reset through the real app route, RoutedLibrary, Settings, Worker authority, IndexedDB vault and
// encrypted guest-edge libraries. Only den-edge's lock replies are an in-memory route fixture.
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { E2E_ORIGIN } from './base-url.mjs';
import { CODE, newEdge, routeGuestEdge } from './guest-edge.mjs';
import { routeProfileResetEdge } from './profile-reset-edge.mjs';
import { sharedWorkerBridge } from './shared-worker-bridge.mjs';

async function seedLocalLibrary(page, lines) {
  await page.goto(`${E2E_ORIGIN}/movie/1002`);
  await page.getByRole('button', { name: 'Look around instead' }).click();
  await expect
    .poll(() => lines.some((line) => line.includes('local session opened')), { timeout: 30_000 })
    .toBe(true);
  const watchlist = page.getByRole('button', { name: 'Watchlist', exact: true });
  await expect(watchlist).toBeVisible({ timeout: 30_000 });
  await watchlist.click();
  await expect(watchlist).toHaveAttribute('aria-pressed', 'true');
  await expect(watchlist).not.toHaveAttribute('data-saving', 'true', { timeout: 30_000 });
}

async function makeProtectedHousehold(page) {
  // The retained Worker keeps background requests alive across tabs; navigation commit is the boundary needed here,
  // while the production invite dialog below is the readiness assertion (waiting for window `load` can hang).
  await page.goto(`${E2E_ORIGIN}/movie/1002#invite=${CODE}`, { waitUntil: 'commit' });
  await page
    .getByRole('dialog', { name: 'Accept this invite?' })
    .getByRole('button', { name: 'Accept' })
    .click();
  const owner = page.getByRole('button', { name: 'Switch profile, current Owner' });
  await expect(owner).toBeVisible({ timeout: 30_000 });
  await owner.click();
  await page.getByRole('button', { name: 'Use Kids' }).click();
  await page.getByLabel('New Owner PIN').fill('1234');
  await page.getByLabel('Confirm Owner PIN').fill('1234');
  const kids = page.getByRole('button', { name: 'Switch profile, current Kids' });
  await expect(kids).toBeVisible({
    timeout: 30_000,
  });
  await kids.click();
  await page.getByRole('button', { name: 'Use Owner' }).click();
  await page.getByLabel('Owner PIN').fill('1234');
  await expect(page.getByRole('button', { name: 'Switch profile, current Owner' })).toBeVisible({
    timeout: 30_000,
  });
  // The visible label is committed before the old activity session's bounded teardown finishes. The persisted Owner
  // hint validates the exact active-profile marker and is the production route's stable authority across that turn.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('den.profile.hint.v1')))
    .not.toBeNull();
}

async function openReset(page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  const ownerGate = page.getByRole('heading', { name: 'Owner access' });
  if (await ownerGate.isVisible()) {
    await page.getByLabel('Owner PIN').fill('1234');
    await page.getByRole('button', { name: 'Open settings' }).click();
  }
  await page.getByRole('button', { name: /Linked devices/ }).click();
  const devices = page.getByRole('region', { name: 'Linked devices' });
  const trigger = devices.getByRole('button', { name: 'Reset library keys…' });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  return devices;
}

test('RoutedLibrary resumes one lost compound reset across reload', async ({
  context,
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium',
    'Web Locks are qualified once; package builds cover TV engines.',
  );
  test.setTimeout(180_000);
  const edge = newEdge({ profiles: true });
  const bridge = await sharedWorkerBridge();
  const lines = [];
  const observe = (target) => {
    target.on('console', (message) => lines.push(`${message.type()} ${message.text()}`));
    target.on('pageerror', (error) => lines.push(`pageerror ${error.message}`));
  };
  let app = page;
  observe(app);
  let forwarder;
  try {
    await routeGuestEdge(app, edge);
    await routeProfileResetEdge(app, edge);
    // Playwright page routes do not observe a SharedWorker's fetches. The production SharedWorker reaches the preview
    // server's upstream bridge, which asks this otherwise blank routed page for only den-edge's fixture answers.
    forwarder = await context.newPage();
    await routeGuestEdge(forwarder, edge);
    await routeProfileResetEdge(forwarder, edge);
    await bridge.answerFrom(forwarder);
    // Seed one durable row, then close its page exactly as a user closes a tab. A new page in the same browser adopts
    // the retained production SharedWorker/vault and exercises invite migration without racing two page-owned models.
    await seedLocalLibrary(app, lines);
    await app.close();
    app = await context.newPage();
    observe(app);
    await routeGuestEdge(app, edge);
    await routeProfileResetEdge(app, edge);
    await makeProtectedHousehold(app);
    const firstDevices = await openReset(app);

    // den-edge commits the household acquire but every reply in the client's bounded retry window is lost. The exact
    // durable marker remains; reload must replay the same attempt after this fixture starts answering again.
    edge.profileResetHoldReplies = true;
    await firstDevices.getByRole('textbox', { name: 'Owner PIN' }).fill('1234');
    await firstDevices.getByRole('button', { name: 'Reset keys' }).click();
    await expect(firstDevices.getByRole('alert')).toContainText('still in progress', {
      timeout: 30_000,
    });
    const marker = JSON.parse(await app.evaluate(() => localStorage.getItem('den.keyReset')));
    expect(marker).toMatchObject({ compound: true });
    expect(edge.profileResetAttempts).toBe(1);
    edge.profileResetHoldReplies = false;

    // Reloading destroys every page-owned model. RoutedLibrary must recover from only the exact durable marker and
    // den-edge journal, finish the one attempt and install the successor without a second PIN or invented restart.
    await app.reload();

    await expect
      .poll(() => app.evaluate(() => localStorage.getItem('den.keyReset')), { timeout: 60_000 })
      .toBeNull();
    const resetOldIds = [...edge.profileResetRecords.keys()];
    expect(resetOldIds.length).toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => edge.profileResetMoved.size, { timeout: 60_000 })
      .toBe(resetOldIds.length);
    expect(edge.profileResetAttempts).toBe(1);
    for (const id of resetOldIds) expect(edge.profileResetMoved.has(id)).toBe(true);

    const links = await app.evaluate(() => JSON.parse(localStorage.getItem('den.links') ?? '[]'));
    expect(links).toHaveLength(1);
    expect(links[0].libraryKey).toBe(marker.to);
    await expect(app.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    const diagnostic = testInfo.outputPath('reset-worker-bridge.txt');
    const edgeSummary = JSON.stringify(
      {
        libraries: [...edge.libraries.keys()],
        libraryRequests: edge.libraryRequests,
        grant: { reserved: edge.grant.reserved, live: edge.grant.live },
        resetAttempts: edge.profileResetAttempts,
      },
      null,
      2,
    );
    await writeFile(
      diagnostic,
      [...lines, '', 'bridge:', ...bridge.log, '', 'edge:', edgeSummary].join('\n'),
    );
    await testInfo.attach('reset-worker-bridge.txt', {
      contentType: 'text/plain',
      path: diagnostic,
    });
    await app.close();
    await forwarder?.close();
    await bridge.close();
  }
});
