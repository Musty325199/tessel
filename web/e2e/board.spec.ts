import { SEEN } from '../playwright.config';
import { test, expect, type Browser, type Page } from '@playwright/test';

const unique = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

async function signUp(page: Page, name: string) {
  await page.goto('/signup');
  await page.fill('#name', name);
  await page.fill('#email', `${name.toLowerCase()}${unique()}@example.com`);
  await page.fill('#password', 'a long password 1');
  await page.click('button:has-text("Create account")');
  await expect(page).toHaveURL(/\/boards/);
}

test('try a board without an account, add a note and keep it after reload', async ({ page }) => {
  await page.goto('/try');
  await expect(page.locator('.sticky').first()).toBeVisible();
  const before = await page.locator('.sticky').count();
  await page.click('[aria-label="Sticky note (S)"]');
  await page.locator('.board').click({ position: { x: 120, y: 260 } });
  await page.keyboard.type('Written in a test');
  await page.locator('.board').click({ position: { x: 20, y: 600 } });
  await expect(page.locator('.sticky')).toHaveCount(before + 1);
  await page.reload();
  await expect(page.locator('.sticky:has-text("Written in a test")')).toBeVisible();
});

test('two people edit the same board live', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough for the two-person test');
  await signUp(page, 'Owner');
  await page.click('.quick-tpl >> nth=1');
  await expect(page).toHaveURL(/\/b\//);
  await page.click('button.share');
  await page.selectOption('#link-access', 'edit');
  await expect(page.locator('#share-link')).toHaveValue(/\?k=/);
  const link = await page.inputValue('#share-link');
  await page.keyboard.press('Escape');

  const other = await (browser as Browser).newContext({ storageState: SEEN });
  const guest = await other.newPage();
  await guest.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(guest.locator('.viewonly')).toContainText('Sign in to edit');
  await guest.click('text=Create account');
  await guest.fill('#name', 'Guest');
  await guest.fill('#email', `guest${unique()}@example.com`);
  await guest.fill('#password', 'a long password 2');
  await guest.click('button:has-text("Create account")');
  await expect(guest.locator('nav.toolbar')).toBeVisible();

  // the guest's cursor shows up for the owner, by name
  await guest.mouse.move(400, 400); await guest.mouse.move(420, 420);
  await expect(page.locator('.cursor .tag')).toContainText('Guest');

  // a note added by the guest appears for the owner
  await guest.click('[aria-label="Sticky note (S)"]');
  await guest.mouse.click(700, 500);
  await guest.keyboard.type('Hello from the guest');
  await guest.mouse.click(1200, 120);
  await expect(page.locator('.sticky:has-text("Hello from the guest")')).toBeVisible();
  await other.close();
});

test('first-time tour shows once and can be skipped', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:4173', storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto('/try');
  await expect(page.locator('.guide-card')).toContainText('Add a note');
  await page.click('.guide-card >> text=Next');
  await expect(page.locator('.guide-card')).toContainText('Bring your team in'); // the practice board has no AI step
  await page.click('.guide-card >> text=Skip');
  await expect(page.locator('.guide')).toHaveCount(0);
  await page.reload();
  await page.locator('.sticky').first().waitFor();
  await page.waitForTimeout(1200);
  await expect(page.locator('.guide')).toHaveCount(0);
  await ctx.close();
});

test('forgot password page', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'me@example.com');
  await page.click('text=Forgot password?');
  await expect(page.locator('h1')).toHaveText('Forgot your password?');
  await expect(page.locator('#email')).toHaveValue('me@example.com');
  await page.goto('/reset');
  await expect(page.locator('h1')).toHaveText('This link isn’t complete');
});
