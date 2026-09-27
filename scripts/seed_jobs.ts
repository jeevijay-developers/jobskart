import { createClient } from '@supabase/supabase-js';
import { faker } from '@faker-js/faker';

// Initialize Supabase Client
// Replace these with your actual Supabase URL and SERVICE ROLE KEY
// DO NOT use the anon key for this script as it needs bypass RLS to insert for different companies
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YOUR_SERVICE_ROLE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const JOB_CATEGORIES = ['Engineering', 'Design', 'Marketing', 'Sales', 'Customer Support', 'Operations', 'Finance', 'HR'];
const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
const SHIFTS = ['Morning', 'Evening', 'Night', 'Flexible'];
const WORK_MODES = ['Remote', 'On-site', 'Hybrid'];
const EDUCATION_LEVELS = ['High School', "Bachelor's", "Master's", 'PhD', 'None'];
const ENGLISH_LEVELS = ['Basic', 'Intermediate', 'Fluent', 'Native', 'Not required'];
const CITIES = ['New York', 'San Francisco', 'London', 'Berlin', 'Tokyo', 'Bangalore', 'Sydney'];
const STATES = ['NY', 'CA', 'LDN', 'BER', 'TOK', 'KA', 'NSW'];

async function seedJobs(numJobs = 200) {
  console.log(`Starting to seed ${numJobs} jobs...`);

  // First, fetch some existing company IDs to associate the jobs with
  const { data: companies, error: companyError } = await supabase
    .from('companies') // Assuming you have a companies table, adjust if needed
    .select('id')
    .limit(50);

  if (companyError || !companies || companies.length === 0) {
    console.error('Error fetching companies or no companies exist. Please create some companies first.', companyError);
    // Fallback: If jobs don't strictly require a company_id, you could bypass this.
    // return; 
  }

  const jobsToInsert = [];

  for (let i = 0; i < numJobs; i++) {
    const minSalary = faker.number.int({ min: 30000, max: 90000 });
    const maxSalary = minSalary + faker.number.int({ min: 10000, max: 50000 });
    const minExp = faker.number.int({ min: 0, max: 5 });
    const maxExp = minExp + faker.number.int({ min: 1, max: 5 });
    
    // Pick a random company from the fetched list (if available)
    const randomCompanyId = companies && companies.length > 0 
        ? faker.helpers.arrayElement(companies).id 
        : null;

    jobsToInsert.push({
      company_id: randomCompanyId,
      title: faker.person.jobTitle(),
      description: faker.lorem.paragraphs(3),
      category: faker.helpers.arrayElement(JOB_CATEGORIES),
      job_type: faker.helpers.arrayElement(JOB_TYPES),
      shift: faker.helpers.arrayElement(SHIFTS),
      work_mode: faker.helpers.arrayElement(WORK_MODES),
      city: faker.helpers.arrayElement(CITIES),
      state: faker.helpers.arrayElement(STATES),
      locality: faker.location.streetAddress(),
      min_salary: minSalary,
      max_salary: maxSalary,
      min_experience_years: minExp,
      max_experience_years: maxExp,
      education: faker.helpers.arrayElement(EDUCATION_LEVELS),
      english_level: faker.helpers.arrayElement(ENGLISH_LEVELS),
      skills: [faker.word.sample(), faker.word.sample(), faker.word.sample()],
      perks: [faker.company.catchPhrase(), faker.company.catchPhrase()],
      openings: faker.number.int({ min: 1, max: 10 }),
      status: 'active', // assuming 'active' is a valid status enum
      quality_score: faker.number.int({ min: 50, max: 100 })
    });
  }

  // Insert in batches of 50 to avoid timeout/payload size issues
  const batchSize = 50;
  for (let i = 0; i < jobsToInsert.length; i += batchSize) {
    const batch = jobsToInsert.slice(i, i + batchSize);
    const { error } = await supabase
      .from('jobs')
      .insert(batch);

    if (error) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, error);
    } else {
      console.log(`Successfully inserted batch ${i / batchSize + 1} (${batch.length} jobs)`);
    }
  }

  console.log('Finished seeding jobs!');
}

seedJobs(250).catch(console.error);
