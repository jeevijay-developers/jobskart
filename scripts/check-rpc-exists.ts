import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://swdntxurukbkyksuyzhg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function checkRpc() {
  const { data: testFeed, error: errFeed } = await supabaseAdmin.rpc('feed_jobs');
  console.log('feed_jobs exists:', !errFeed, errFeed ? errFeed.message : `(returned ${testFeed?.length || 0} rows)`);

  const { data: testCand, error: errCand } = await supabaseAdmin.rpc('feed_jobs_for_candidate');
  console.log('feed_jobs_for_candidate exists:', !errCand, errCand ? errCand.message : `(returned ${testCand?.length || 0} rows)`);
}

checkRpc().catch(console.error);
