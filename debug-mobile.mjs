import { chromium, devices } from '@playwright/test';
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'ru-RU' });
const page = await context.newPage();
await page.goto('http://127.0.0.1:3113/login');
await page.getByLabel('Логин').fill('tester');
await page.getByLabel('Пароль').fill('tester-password');
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login'));
await page.goto('http://127.0.0.1:3113/all-tasks');
await page.waitForTimeout(2500);

await page
  .getByRole('button', { name: /Фильтры/ })
  .first()
  .click();
await page.waitForTimeout(600);
console.log('после «Фильтры» — диалогов:', await page.getByRole('dialog').count());

await page.getByRole('button', { name: 'Фильтр', exact: true }).click();
await page.waitForTimeout(400);
console.log('после «Фильтр» — диалогов:', await page.getByRole('dialog').count());

const panel = page.getByRole('dialog');
await panel.getByRole('button', { name: 'Исполнитель', exact: true }).click();
await page.waitForTimeout(300);
await panel.getByRole('checkbox', { name: 'Мария Орлова' }).check();
await page.waitForTimeout(400);
console.log('после галочки — диалогов:', await page.getByRole('dialog').count());
console.log('чип виден до Escape:', await page.getByText('Исполнитель: Мария Орлова').count());

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
console.log('после Escape — диалогов:', await page.getByRole('dialog').count());
console.log('чип виден после Escape:', await page.getByText('Исполнитель: Мария Орлова').count());
await browser.close();
