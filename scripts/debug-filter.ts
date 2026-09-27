import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://swdntxurukbkyksuyzhg.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_3HmYVbxcRWQRa56pNK7UPg_QhuDXqka';

const seedPath = path.join(process.cwd(), 'test-results', 'applied-jobs', 'latest_seed.json');

async function debugFilter() {
  const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  const candidate = seedData.candidates[0];

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: candidate.email, password: candidate.password });

  const { data: cityFiltered, error } = await userClient.rpc('feed_jobs_for_candidate', {
    _city: 'Delhi',
    _limit: 50,
    _offset: 0,
    _vehicle: false,
    _verified_only: false,
    _sort: 'recommended'
  });

  console.log('Error:', error);
  console.log('Returned count:', cityFiltered?.length);
  const cities = (cityFiltered || []).map((j: any) => j.city);
  console.log('Cities in returned rows:', cities);
  const nonDelhi = (cityFiltered || []).filter((j: any) => j.city !== 'Delhi');
  console.log('Non-Delhi rows:', nonDelhi);
}

debugFilter().catch(console.error);
