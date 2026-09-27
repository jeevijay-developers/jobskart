import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Target Environment Credentials
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://swdntxurukbkyksuyzhg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase Service Role Key or URL');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const TIMESTAMP = Date.now();
const RUN_TAG = `E2E_APPLIED_JOBS_${TIMESTAMP}`;

console.log(`================================================`);
console.log(`Starting E2E Seed Run: ${RUN_TAG}`);
console.log(`Supabase URL: ${SUPABASE_URL}`);
console.log(`================================================`);

const CATEGORIES = ['Engineering', 'Sales', 'Healthcare', 'Retail', 'Finance', 'Logistics', 'Education', 'Hospitality'];
const CITIES = ['Delhi', 'Jaipur', 'Mumbai', 'Bengaluru', 'Pune', 'Ahmedabad', 'Remote'];
const JOB_TYPES = ['full_time', 'part_time', 'contract'];
const WORK_MODES = ['onsite', 'hybrid', 'remote'];
const SHIFTS = ['day', 'night', 'flexible'];
const EDUCATION_LEVELS = ["High School", "Bachelor's", "Master's"];
const ENGLISH_LEVELS = ['Basic', 'Intermediate', 'Fluent'];

const SALARY_BANDS = [
  { name: 'low', min: 15000, max: 28000 },
  { name: 'medium', min: 35000, max: 75000 },
  { name: 'high', min: 85000, max: 150000 },
];

const EXP_RANGES = [
  { level: 'entry', min: 0, max: 2 },
  { level: 'mid', min: 2, max: 5 },
  { level: 'senior', min: 5, max: 10 },
];

const ROLES = [
  'Software Engineer', 'Sales Executive', 'Nurse Practitioner', 'Store Manager',
  'Financial Analyst', 'Logistics Coordinator', 'Math Teacher', 'Front Desk Agent'
];

async function main() {
  const seedOutput: any = {
    runTag: RUN_TAG,
    timestamp: TIMESTAMP,
    candidates: [],
    employers: [],
    companies: [],
    jobs: {
      activeCount: 0,
      inactiveCount: 0,
      expiredCount: 0,
      boostedCount: 0,
      ids: []
    },
    applicationsCount: 0
  };

  // 1. Create 10 Employer Auth Users + 10 Companies
  console.log('\n--- Creating 10 Employers & Companies ---');
  const companies: { id: string; name: string }[] = [];
  for (let i = 1; i <= 10; i++) {
    const email = `e2e_employer_${i}_${TIMESTAMP}@test.com`;
    const password = 'TestPassword123!';

    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `E2E Employer ${i}`, user_type: 'employer' }
    });

    if (userError || !userData.user) {
      console.error(`Failed to create employer ${email}:`, userError);
      continue;
    }

    const userId = userData.user.id;

    // Profile insert/upsert
    await supabase.from('profiles').upsert({
      id: userId,
      full_name: `E2E Employer ${i}`,
      email,
      user_type: 'employer',
      city: CITIES[i % CITIES.length]
    });

    // Company insert
    const companyName = `${RUN_TAG} Company ${i}`;
    const { data: companyData, error: companyError } = await supabase.from('companies').insert({
      name: companyName,
      company_type: 'pvt_ltd',
      industry: CATEGORIES[i % CATEGORIES.length],
      size: '11-50',
      is_verified: i % 2 === 0, // half verified
      created_by: userId
    }).select().single();

    if (companyError || !companyData) {
      console.error(`Failed to create company for ${email}:`, companyError);
      continue;
    }

    // Employer member link
    await supabase.from('employer_members').insert({
      user_id: userId,
      company_id: companyData.id,
      role: 'super_admin'
    });

    companies.push({ id: companyData.id, name: companyName });
    seedOutput.employers.push({ id: userId, email, password, companyId: companyData.id });
  }

  console.log(`Created ${companies.length} companies.`);

  // 2. Create 10 Candidates
  console.log('\n--- Creating 10 Candidates ---');
  const candidates: { id: string; email: string; city: string }[] = [];
  for (let i = 1; i <= 10; i++) {
    const email = `e2e_candidate_${i}_${TIMESTAMP}@test.com`;
    const password = 'TestPassword123!';
    const city = CITIES[(i - 1) % CITIES.length];

    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `E2E Candidate ${i}`, user_type: 'candidate' }
    });

    if (userError || !userData.user) {
      console.error(`Failed to create candidate ${email}:`, userError);
      continue;
    }

    const userId = userData.user.id;

    await supabase.from('profiles').upsert({
      id: userId,
      full_name: `E2E Candidate ${i}`,
      email,
      user_type: 'candidate',
      city
    });

    await supabase.from('candidate_profiles').upsert({
      user_id: userId,
      experience_status: i <= 3 ? 'fresher' : 'experienced',
      years_experience: (i - 1) * 1.5,
      skills: ['TypeScript', 'Sales', 'Customer Service'].slice(0, (i % 3) + 1),
      preferred_job_types: ['Full-time']
    });

    candidates.push({ id: userId, email, city });
    seedOutput.candidates.push({ id: userId, email, password, city });
  }

  console.log(`Created ${candidates.length} candidates.`);

  // 3. Create 240 Active Jobs + 10 Inactive + 10 Expired
  console.log('\n--- Creating 260 Test Jobs ---');
  const activeJobs: { id: string; companyId: string; title: string; category: string }[] = [];
  const allJobIds: string[] = [];

  // Matrix generation for 240 active jobs
  let jobCounter = 0;
  for (let cIdx = 0; cIdx < CATEGORIES.length; cIdx++) {
    const category = CATEGORIES[cIdx];
    for (let locIdx = 0; locIdx < CITIES.length; locIdx++) {
      const city = CITIES[locIdx];
      for (let expIdx = 0; expIdx < EXP_RANGES.length; expIdx++) {
        const exp = EXP_RANGES[expIdx];
        const sal = SALARY_BANDS[(jobCounter) % SALARY_BANDS.length];
        const jobType = JOB_TYPES[jobCounter % JOB_TYPES.length];
        const workMode = WORK_MODES[jobCounter % WORK_MODES.length];
        const shift = SHIFTS[jobCounter % SHIFTS.length];
        const education = EDUCATION_LEVELS[jobCounter % EDUCATION_LEVELS.length];
        const englishLevel = ENGLISH_LEVELS[jobCounter % ENGLISH_LEVELS.length];
        const company = companies[jobCounter % companies.length];
        const roleName = ROLES[cIdx % ROLES.length];

        const title = `${RUN_TAG} ${exp.level.toUpperCase()} ${roleName} #${jobCounter + 1}`;

        const { data: jobData, error: jobError } = await supabase.from('jobs').insert({
          company_id: company.id,
          title,
          description: `Detailed E2E test job description for ${title}. Run Tag: ${RUN_TAG}`,
          category,
          job_type: jobType,
          work_mode: workMode,
          shift,
          education,
          english_level: englishLevel,
          city,
          state: 'State',
          locality: 'Center Area',
          min_salary: sal.min,
          max_salary: sal.max,
          min_experience_years: exp.min,
          max_experience_years: exp.max,
          skills: ['TypeScript', 'Communication', 'Management'],
          status: 'active',
          openings: 5,
          quality_score: 90 + (jobCounter % 10)
        }).select().single();

        if (jobError || !jobData) {
          console.error(`Failed to insert active job ${jobCounter}:`, jobError);
        } else {
          activeJobs.push({ id: jobData.id, companyId: company.id, title, category });
          allJobIds.push(jobData.id);

          // Boost every 6th job
          if (jobCounter % 6 === 0) {
            await supabase.from('job_boosts').insert({
              job_id: jobData.id,
              company_id: company.id,
              starts_at: new Date().toISOString(),
              ends_at: new Date(Date.now() + 7 * 86400000).toISOString()
            });
            seedOutput.jobs.boostedCount++;
          }
        }
        jobCounter++;
        if (jobCounter >= 240) break;
      }
      if (jobCounter >= 240) break;
    }
    if (jobCounter >= 240) break;
  }

  seedOutput.jobs.activeCount = activeJobs.length;
  console.log(`Created ${activeJobs.length} active jobs (${seedOutput.jobs.boostedCount} boosted).`);

  // 10 Inactive Jobs
  console.log('Creating 10 inactive jobs...');
  for (let i = 1; i <= 10; i++) {
    const company = companies[i % companies.length];
    const { data: jobData } = await supabase.from('jobs').insert({
      company_id: company.id,
      title: `${RUN_TAG} INACTIVE Job ${i}`,
      description: `Inactive draft job`,
      category: 'Engineering',
      job_type: 'full_time',
      work_mode: 'onsite',
      city: 'Delhi',
      status: 'draft'
    }).select().single();
    if (jobData) allJobIds.push(jobData.id);
  }
  seedOutput.jobs.inactiveCount = 10;

  // 10 Expired Jobs
  console.log('Creating 10 expired jobs...');
  for (let i = 1; i <= 10; i++) {
    const company = companies[i % companies.length];
    const { data: jobData } = await supabase.from('jobs').insert({
      company_id: company.id,
      title: `${RUN_TAG} EXPIRED Job ${i}`,
      description: `Expired job`,
      category: 'Sales',
      job_type: 'full_time',
      work_mode: 'onsite',
      city: 'Mumbai',
      status: 'active',
      expires_at: new Date(Date.now() - 86400000).toISOString()
    }).select().single();
    if (jobData) allJobIds.push(jobData.id);
  }
  seedOutput.jobs.expiredCount = 10;
  seedOutput.jobs.ids = allJobIds;

  // 4. Create Applications for candidates (22 per candidate across statuses)
  console.log('\n--- Creating Applications for Candidates ---');
  const STATUSES: Array<'applied' | 'shortlisted' | 'interview' | 'hired' | 'rejected' | 'withdrawn'> = [
    'applied', 'applied', 'applied', 'applied', 'applied',
    'shortlisted', 'shortlisted', 'shortlisted', 'shortlisted',
    'interview', 'interview', 'interview', 'interview',
    'hired', 'hired', 'hired',
    'rejected', 'rejected', 'rejected',
    'withdrawn', 'withdrawn', 'withdrawn'
  ];

  let totalApps = 0;
  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const candidate = candidates[cIdx];
    // Offset job index per candidate so they apply to different sets of 22 jobs
    const startIndex = (cIdx * 20) % (activeJobs.length - 25);
    const targetJobs = activeJobs.slice(startIndex, startIndex + 22);

    for (let aIdx = 0; aIdx < targetJobs.length; aIdx++) {
      const job = targetJobs[aIdx];
      const status = STATUSES[aIdx % STATUSES.length];

      const { error: appError } = await supabase.from('applications').insert({
        job_id: job.id,
        candidate_id: candidate.id,
        company_id: job.companyId,
        status,
        cover_note: `E2E Application Note for ${job.title}`
      });

      if (!appError) {
        totalApps++;
      } else {
        console.error(`Failed to insert application for ${candidate.email}:`, appError);
      }
    }
  }

  seedOutput.applicationsCount = totalApps;
  console.log(`Created ${totalApps} applications across 10 candidates.`);

  // Write Seed Metadata artifact for test runner & cleanup
  const outputDir = path.join(process.cwd(), 'test-results', 'applied-jobs');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(
    path.join(outputDir, 'latest_seed.json'),
    JSON.stringify(seedOutput, null, 2)
  );

  console.log(`\n✅ Seed completed successfully!`);
  console.log(`Metadata saved to: test-results/applied-jobs/latest_seed.json`);
}

main().catch(err => {
  console.error('Fatal seeding error:', err);
  process.exit(1);
});
