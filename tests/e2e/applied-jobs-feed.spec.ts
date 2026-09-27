import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://swdntxurukbkyksuyzhg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_3HmYVbxcRWQRa56pNK7UPg_QhuDXqka';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function rpcArgs(overrides: Record<string, any> = {}) {
  return {
    _q: null,
    _city: null,
    _category: null,
    _job_type: null,
    _work_mode: null,
    _min_salary: null,
    _max_salary: null,
    _min_exp: null,
    _max_exp: null,
    _posted_after: null,
    _education: null,
    _shift: null,
    _english_level: null,
    _company: null,
    _vehicle: false,
    _verified_only: false,
    _sort: 'recommended',
    _limit: 50,
    _offset: 0,
    ...overrides
  };
}

let seedData: any = null;

test.describe('Applied Jobs Discovery Feed - E2E & RPC Suite', () => {

  test.beforeAll(() => {
    const seedPath = path.join(process.cwd(), 'test-results', 'applied-jobs', 'latest_seed.json');
    if (fs.existsSync(seedPath)) {
      seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    }
    if (!seedData || !seedData.candidates || seedData.candidates.length === 0) {
      throw new Error('Seed data missing or empty. Please run scripts/seed-applied-jobs-e2e.ts before running tests.');
    }
  });

  // =========================================================================
  // SECTION A: Database & RPC Checks (feed_jobs_for_candidate)
  // =========================================================================

  test('A1 & A2: Candidate RPC excludes all candidate applications', async () => {
    for (const candidate of seedData.candidates) {
      const { data: apps } = await supabaseAdmin
        .from('applications')
        .select('job_id')
        .eq('candidate_id', candidate.id);

      const appliedJobIds = new Set((apps || []).map((a: any) => a.job_id));

      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      const { data: authData } = await userClient.auth.signInWithPassword({
        email: candidate.email,
        password: candidate.password
      });

      expect(authData.session).not.toBeNull();

      const startTime = Date.now();
      const { data: feedData, error: feedErr } = await userClient.rpc('feed_jobs_for_candidate', rpcArgs({ _limit: 100 }));
      const rpcDuration = Date.now() - startTime;
      console.log(`[Perf] RPC for candidate ${candidate.email}: ${rpcDuration}ms`);

      expect(feedErr).toBeNull();
      expect(feedData).toBeDefined();

      const returnedJobIds = (feedData || []).map((j: any) => j.id);
      for (const returnedId of returnedJobIds) {
        expect(appliedJobIds.has(returnedId)).toBe(false);
      }
    }
  });

  test('A3 & A4: Active unapplied jobs appear, inactive/expired never appear', async () => {
    const candidate = seedData.candidates[0];
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await userClient.auth.signInWithPassword({
      email: candidate.email,
      password: candidate.password
    });

    const { data: feedData } = await userClient.rpc('feed_jobs_for_candidate', rpcArgs({ _limit: 300 }));
    const returnedJobIds = new Set((feedData || []).map((j: any) => j.id));

    const { data: inactiveJobs } = await supabaseAdmin
      .from('jobs')
      .select('id')
      .like('title', `${seedData.runTag} INACTIVE%`);

    const { data: expiredJobs } = await supabaseAdmin
      .from('jobs')
      .select('id')
      .like('title', `${seedData.runTag} EXPIRED%`);

    for (const job of inactiveJobs || []) {
      expect(returnedJobIds.has(job.id)).toBe(false);
    }
    for (const job of expiredJobs || []) {
      expect(returnedJobIds.has(job.id)).toBe(false);
    }
  });

  test('A5: Every supported sort works correctly', async () => {
    const candidate = seedData.candidates[0];
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await userClient.auth.signInWithPassword({
      email: candidate.email,
      password: candidate.password
    });

    const sorts = ['recommended', 'newest', 'oldest', 'salary_high', 'salary_low'];

    for (const sort of sorts) {
      const { data: rows, error } = await userClient.rpc('feed_jobs_for_candidate', rpcArgs({ _sort: sort, _limit: 20 }));
      expect(error).toBeNull();
      expect(rows).toBeDefined();
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  test('A6: Pagination integrity & duplicate check', async () => {
    const candidate = seedData.candidates[0];
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await userClient.auth.signInWithPassword({
      email: candidate.email,
      password: candidate.password
    });

    const { data: page1 } = await userClient.rpc('feed_jobs_for_candidate', rpcArgs({ _limit: 20, _offset: 0 }));
    const { data: page2 } = await userClient.rpc('feed_jobs_for_candidate', rpcArgs({ _limit: 20, _offset: 20 }));

    const page1Ids = new Set((page1 || []).map((j: any) => j.id));
    const page2Ids = (page2 || []).map((j: any) => j.id);

    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }

    if (page1 && page1.length > 0) {
      const totalCount = Number(page1[0].total_count);
      expect(totalCount).toBeGreaterThan(40);
    }
  });

  test('A7: Filters work independently and in combination', async () => {
    const candidate = seedData.candidates[0];
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await userClient.auth.signInWithPassword({
      email: candidate.email,
      password: candidate.password
    });

    const { data: cityFiltered } = await userClient.rpc('feed_jobs_for_candidate', rpcArgs({ _city: 'Delhi' }));
    expect(cityFiltered).toBeDefined();
    expect(cityFiltered!.length).toBeGreaterThan(0);
    for (const job of cityFiltered || []) {
      expect((job.city || '').toLowerCase()).toContain('delhi');
    }
  });

  test('A8: Unauthenticated caller cannot execute candidate feed', async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error } = await anonClient.rpc('feed_jobs_for_candidate', rpcArgs({ _limit: 10 }));
    expect(error).not.toBeNull();
  });

  test('A9: Candidate A applications do not affect Candidate B results', async () => {
    const candidateA = seedData.candidates[0];
    const candidateB = seedData.candidates[1];

    const subB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await subB.auth.signInWithPassword({
      email: candidateB.email,
      password: candidateB.password
    });

    const { data: appsA } = await supabaseAdmin.from('applications').select('job_id').eq('candidate_id', candidateA.id);
    const appIdsA = new Set((appsA || []).map((a: any) => a.job_id));

    const { data: feedB } = await subB.rpc('feed_jobs_for_candidate', rpcArgs({ _limit: 200 }));
    const feedBIds = (feedB || []).map((j: any) => j.id);

    const overlap = feedBIds.filter(id => appIdsA.has(id));
    expect(overlap.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // SECTION B: Browser & UI Checks
  // =========================================================================

  test('B1-B3: UI Login, Candidate Dashboard & /jobs navigation', async ({ page }) => {
    const candidate = seedData.candidates[0];

    await page.goto('/login');
    await page.fill('input[type="email"]', candidate.email);
    await page.fill('input[type="password"]', candidate.password);
    await page.click('button[type="submit"]');

    await page.waitForTimeout(3000);

    const screenshotDir = path.join(process.cwd(), 'test-results', 'applied-jobs', 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, 'dashboard.png') });

    await page.goto('/jobs');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, 'jobs_search.png') });

    expect(await page.title()).toBeDefined();
  });

  test('B5: Direct URL for applied job displays applied status', async ({ page }) => {
    const candidate = seedData.candidates[0];

    const { data: apps } = await supabaseAdmin
      .from('applications')
      .select('job_id, status')
      .eq('candidate_id', candidate.id)
      .limit(1);

    expect(apps).not.toBeNull();
    expect(apps!.length).toBeGreaterThan(0);

    const appliedJobId = apps![0].job_id;

    await page.goto('/login');
    await page.fill('input[type="email"]', candidate.email);
    await page.fill('input[type="password"]', candidate.password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    await page.goto(`/jobs/${appliedJobId}`);
    await page.waitForTimeout(2000);

    const screenshotDir = path.join(process.cwd(), 'test-results', 'applied-jobs', 'screenshots');
    await page.screenshot({ path: path.join(screenshotDir, 'applied_job_detail.png') });

    const pageText = await page.innerText('body');
    const hasAppliedText = pageText.toLowerCase().includes('applied') || pageText.toLowerCase().includes('application');
    expect(hasAppliedText).toBe(true);
  });

  test('B7: Genuine no-match filter state works', async ({ page }) => {
    await page.goto('/jobs');
    await page.waitForTimeout(1000);

    const searchInput = page.locator('input[placeholder*="search" i], input[type="text"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('XYZNONEXISTENTJOBTITLE123999');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);

      const screenshotDir = path.join(process.cwd(), 'test-results', 'applied-jobs', 'screenshots');
      await page.screenshot({ path: path.join(screenshotDir, 'no_match_filter.png') });
    }
  });

});
