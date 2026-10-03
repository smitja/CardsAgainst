import { devices, expect, test, type Browser, type Page } from '@playwright/test';

/** Profili telefono senza il browser predefinito (qui gira tutto su Chromium). */
function phone(name: 'iPhone SE' | 'Pixel 7') {
  const { defaultBrowserType: _ignored, ...profile } = devices[name];
  return profile;
}

async function openPhone(browser: Browser, profile: 'iPhone SE' | 'Pixel 7') {
  const context = await browser.newContext(phone(profile));
  return context.newPage();
}

/** Un'azione del giocatore su questa pagina, se ce n'è una da fare. */
async function act(page: Page): Promise<string | null> {
  const button = (name: string | RegExp) =>
    page.getByRole('button', { name, exact: typeof name === 'string' });

  const play = button('Gioca');
  if (await play.isVisible().catch(() => false)) {
    if (await play.isEnabled()) {
      await play.click();
      return 'gioca';
    }
  }
  const choose = page.getByRole('button', { name: /^Scegli \d cart[ae]$/ });
  if (await choose.isVisible().catch(() => false)) {
    await page.locator('.white-card[aria-pressed="false"]').first().click();
    return 'seleziona';
  }
  for (const name of [/^Svela la/, 'Scegli questa', 'Round successivo']) {
    const b = button(name).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click();
      return String(name);
    }
  }
  return null;
}

test('quattro telefoni giocano una partita completa', async ({ browser }) => {
  const host = await openPhone(browser, 'iPhone SE');
  await host.goto('/');
  await host.getByLabel('Il tuo nickname').fill('Giulia');
  await host.getByRole('button', { name: 'Crea stanza' }).click();
  await expect(host).toHaveURL(/\/r\/[A-Z]{4}$/);
  const code = host.url().slice(-4);
  await expect(host.getByRole('heading', { name: /In stanza \(1\/10\)/ })).toBeVisible();
  // QR e codice visibili per invitare gli altri.
  await expect(
    host.getByRole('img', { name: `QR per entrare nella stanza ${code}` }),
  ).toBeVisible();

  const others: Page[] = [];
  for (const [name, profile] of [
    ['Marco', 'Pixel 7'],
    ['Luca', 'iPhone SE'],
    ['Sara', 'Pixel 7'],
  ] as const) {
    const p = await openPhone(browser, profile);
    await p.goto(`/r/${code}`);
    await p.getByLabel('Il tuo nickname').fill(name);
    await p.getByRole('button', { name: 'Entra nella stanza' }).click();
    await expect(p.getByText('Aspettiamo che l’host inizi la partita.')).toBeVisible();
    others.push(p);
  }
  const pages = [host, ...others];
  await expect(host.getByRole('heading', { name: /In stanza \(4\/10\)/ })).toBeVisible();

  // Il mazzo di casa è attivo di default; il mazzo base si può aggiungere e togliere.
  const casa = host.getByRole('switch', { name: /Cards Against Cirelli/ });
  const base = host.getByRole('switch', { name: /Mazzo base/ });
  await expect(casa).toBeChecked();
  await expect(casa).toBeDisabled();
  await expect(base).not.toBeChecked();
  await base.click();
  await expect(base).toBeChecked();
  await expect(casa).toBeEnabled();
  await base.click();
  await expect(base).not.toBeChecked();

  await host.getByLabel('Punti per vincere').selectOption('3');
  await host.getByRole('button', { name: 'Inizia la partita' }).click();

  // Nessuna pagina deve mai scorrere in orizzontale.
  const noHorizontalScroll = async () => {
    for (const p of pages) {
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  };

  let rounds = 0;
  let idle = 0;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (
      await host
        .getByRole('heading', { name: /^Vince / })
        .isVisible()
        .catch(() => false)
    )
      break;
    let acted = false;
    for (const p of pages) {
      const what = await act(p);
      if (what === 'Round successivo') rounds += 1;
      if (what) acted = true;
    }
    if (rounds === 1 && acted) await noHorizontalScroll();
    idle = acted ? 0 : idle + 1;
    if (!acted) await host.waitForTimeout(250);
    expect(idle).toBeLessThan(80);
  }

  for (const p of pages) {
    await expect(p.getByRole('heading', { name: /^Vince / })).toBeVisible();
    await expect(p.getByRole('list', { name: 'Classifica' })).toBeVisible();
  }
  expect(rounds).toBeGreaterThanOrEqual(3);
  await noHorizontalScroll();

  // Rivincita: si torna in lobby con tutti dentro.
  await host.getByRole('button', { name: 'Rivincita' }).click();
  await expect(host.getByRole('heading', { name: /In stanza \(4\/10\)/ })).toBeVisible();
});

test('chi ricarica la pagina a metà round ritrova la sua mano', async ({ browser }) => {
  const host = await openPhone(browser, 'Pixel 7');
  await host.goto('/');
  await host.getByLabel('Il tuo nickname').fill('Anna');
  await host.getByRole('button', { name: 'Crea stanza' }).click();
  await expect(host).toHaveURL(/\/r\/[A-Z]{4}$/);
  const code = host.url().slice(-4);
  const others: Page[] = [];
  for (const name of ['Bruno', 'Carla']) {
    const p = await openPhone(browser, 'iPhone SE');
    await p.goto(`/r/${code}`);
    await p.getByLabel('Il tuo nickname').fill(name);
    await p.getByRole('button', { name: 'Entra nella stanza' }).click();
    others.push(p);
  }
  await host.getByRole('button', { name: 'Inizia la partita' }).click();

  const all = [host, ...others];
  const player = await (async () => {
    for (let i = 0; i < 40; i++) {
      for (const p of all) {
        if ((await p.locator('.white-card').count()) > 0) return p;
      }
      await host.waitForTimeout(250);
    }
    throw new Error('nessuna mano visibile');
  })();
  const before = await player.locator('.white-card').allTextContents();
  await player.reload();
  await expect(player.locator('.white-card')).toHaveCount(10);
  expect(await player.locator('.white-card').allTextContents()).toEqual(before);
});
