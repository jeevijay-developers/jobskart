import { chromium } from 'playwright';
const browser = await chromium.launch();

async function testMobileLogin(w, dir) {
  const page = await browser.newPage({ viewport: { width: w, height: 800 } });
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(1000);

  const logo = page.locator('header img[alt="JobsKart"]').first();
  const loginBtn = page.locator('header button:has-text("Login")').first();
  const hamburger = page.locator('header button[aria-label="Open menu"]');

  const logoBox = await logo.boundingBox();
  const loginBox = await loginBtn.boundingBox();
  const hamburgerBox = await hamburger.boundingBox();

  console.log(`[${w}px] logoBox=${JSON.stringify(logoBox)}`);
  console.log(`[${w}px] loginBox=${JSON.stringify(loginBox)}`);
  console.log(`[${w}px] hamburgerBox=${JSON.stringify(hamburgerBox)}`);

  const sameRow = Math.abs(logoBox.y - loginBox.y) < 10 && Math.abs(loginBox.y - hamburgerBox.y) < 10;
  console.log(`[${w}px] sameRow=${sameRow}`);
  console.log(`[${w}px] orderCorrect=${logoBox.x < loginBox.x && loginBox.x < hamburgerBox.x}`);

  const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(`[${w}px] hOverflow=${hasHScroll}`);

  await page.screenshot({ path: dir + `/navlogin-header-${w}.png` });

  // Click Login, verify dropdown opens with both options
  await loginBtn.click();
  await page.waitForTimeout(400);
  const employerOpt = page.locator('text=Employer Login').first();
  const candidateOpt = page.locator('text=Candidate Login').first();
  const employerVisible = await employerOpt.isVisible().catch(() => false);
  const candidateVisible = await candidateOpt.isVisible().catch(() => false);
  console.log(`[${w}px] dropdownOpen: employerVisible=${employerVisible} candidateVisible=${candidateVisible}`);

  await page.screenshot({ path: dir + `/navlogin-dropdown-${w}.png` });

  // Click outside, verify it closes
  await page.mouse.click(10, 400);
  await page.waitForTimeout(300);
  const employerVisibleAfter = await employerOpt.isVisible().catch(() => false);
  console.log(`[${w}px] closesOnOutsideClick=${!employerVisibleAfter}`);

  // Reopen, click Employer Login, verify navigation
  await loginBtn.click();
  await page.waitForTimeout(400);
  await page.locator('text=Employer Login').first().click();
  await page.waitForTimeout(1000);
  console.log(`[${w}px] afterEmployerLoginClick URL=${page.url()}`);

  await page.close();
}

const dir = process.argv[2];
const w = parseInt(process.argv[3]);
await testMobileLogin(w, dir);
console.log('DONE');
await browser.close();
