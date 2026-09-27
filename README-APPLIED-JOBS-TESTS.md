# Applied Jobs Discovery Feed — Production Readiness E2E Test Suite

This directory contains the automated test harness for validating the **Applied Jobs Discovery Feed** feature in a safe test/staging environment.

---

## Safety & Target Environment Rules

- **Strict Run Tagging**: All generated data (employers, candidates, companies, jobs, applications) is tagged with a unique run identifier `E2E_APPLIED_JOBS_<timestamp>`.
- **Targeted Cleanup**: The cleanup script strictly deletes records matching the current run tag in dependency-safe order.
- **Service Role Key Safety**: Server-side credentials are used exclusively in NodeJS scripts and never exposed to browser code.

---

## Command-by-Command Execution Guide

### Step 1: Install Test Dependencies
Ensure Playwright, Faker, and TSX are installed:
```bash
bun add -D @playwright/test @faker-js/faker tsx
# Or with npm:
# npm install -D @playwright/test @faker-js/faker tsx
```

### Step 2: Seed the Test Matrix (240 Active Jobs + Candidates)
Generates 10 candidates, 10 companies, 240 active jobs, 10 inactive, 10 expired, and 220+ applications across all statuses.
```bash
npx tsx scripts/seed-applied-jobs-e2e.ts
```

### Step 3: Run Automated RPC & E2E Test Suite
Executes the Playwright suite covering Database/RPC exclusions, filter matrix, sort correctness, candidate isolation, and UI card invariants.
```bash
npx playwright test tests/e2e/applied-jobs-feed.spec.ts
```

### Step 4: Generate Execution Report
View the generated HTML report or check the structured test outputs:
- Markdown Report: `test-results/applied-jobs/<run-id>/report.md`
- Raw JSON Metrics: `test-results/applied-jobs/results.json`
- HTML Playwright Report: `test-results/applied-jobs/html-report/index.html`

### Step 5: Clean Up Test Data
Removes all test candidates, companies, jobs, and applications created during the seed step:
```bash
npx tsx scripts/cleanup-applied-jobs-e2e.ts
```

---

## Test Deliverables & Directory Layout

```text
├── scripts/
│   ├── seed-applied-jobs-e2e.ts       # Database & auth user seed harness
│   └── cleanup-applied-jobs-e2e.ts    # Dependency-safe cleanup script
├── tests/e2e/
│   └── applied-jobs-feed.spec.ts      # Playwright E2E and RPC test spec
├── test-results/applied-jobs/
│   ├── latest_seed.json              # Seed metadata (run tag, IDs)
│   ├── results.json                  # Test results summary
│   ├── report.md                     # Markdown summary report
│   └── screenshots/                  # Failure and state screenshots
└── playwright.config.ts              # Playwright runner configuration
```
