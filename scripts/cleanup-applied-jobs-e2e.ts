import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://swdntxurukbkyksuyzhg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function cleanup() {
  const seedFilePath = path.join(process.cwd(), 'test-results', 'applied-jobs', 'latest_seed.json');

  if (!fs.existsSync(seedFilePath)) {
    console.error(`No seed metadata file found at ${seedFilePath}. Aborting cleanup to prevent unintended deletions.`);
    process.exit(1);
  }

  const seedData = JSON.parse(fs.readFileSync(seedFilePath, 'utf-8'));
  const runTag = seedData.runTag;

  if (!runTag || !runTag.startsWith('E2E_APPLIED_JOBS_')) {
    console.error(`Invalid run tag '${runTag}'. Aborting cleanup.`);
    process.exit(1);
  }

  console.log(`================================================`);
  console.log(`Cleaning up test run data for tag: ${runTag}`);
  console.log(`================================================`);

  const candidateIds: string[] = (seedData.candidates || []).map((c: any) => c.id);
  const employerIds: string[] = (seedData.employers || []).map((e: any) => e.id);
  const allUserIds = [...candidateIds, ...employerIds];

  // 1. Delete Applications
  if (candidateIds.length > 0) {
    console.log(`Deleting applications for ${candidateIds.length} candidate(s)...`);
    const { error: appErr } = await supabase.from('applications').delete().in('candidate_id', candidateIds);
    if (appErr) console.error('Error deleting applications:', appErr);
  }

  // 2. Delete Job Boosts
  console.log('Deleting job boosts for tagged jobs...');
  const { data: taggedJobs } = await supabase.from('jobs').select('id').like('title', `${runTag}%`);
  const taggedJobIds = (taggedJobs || []).map((j: any) => j.id);

  if (taggedJobIds.length > 0) {
    await supabase.from('job_boosts').delete().in('job_id', taggedJobIds);

    // 3. Delete Jobs
    console.log(`Deleting ${taggedJobIds.length} tagged job(s)...`);
    const { error: jobErr } = await supabase.from('jobs').delete().in('id', taggedJobIds);
    if (jobErr) console.error('Error deleting jobs:', jobErr);
  }

  // 4. Delete Employer Members & Companies
  if (employerIds.length > 0) {
    console.log(`Deleting employer_members links...`);
    await supabase.from('employer_members').delete().in('user_id', employerIds);
  }

  console.log('Deleting tagged companies...');
  const { error: compErr } = await supabase.from('companies').delete().like('name', `${runTag}%`);
  if (compErr) console.error('Error deleting companies:', compErr);

  // 5. Delete Profiles & Auth Users
  if (candidateIds.length > 0) {
    console.log('Deleting candidate profiles...');
    await supabase.from('candidate_profiles').delete().in('user_id', candidateIds);
  }

  if (allUserIds.length > 0) {
    console.log(`Deleting ${allUserIds.length} user profile(s)...`);
    await supabase.from('profiles').delete().in('id', allUserIds);

    console.log(`Deleting ${allUserIds.length} auth user(s)...`);
    for (const userId of allUserIds) {
      const { error: deleteUserErr } = await supabase.auth.admin.deleteUser(userId);
      if (deleteUserErr) {
        console.error(`Failed to delete auth user ${userId}:`, deleteUserErr);
      }
    }
  }

  console.log(`\n✅ Cleanup finished successfully for run tag: ${runTag}`);
}

cleanup().catch(err => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
});
