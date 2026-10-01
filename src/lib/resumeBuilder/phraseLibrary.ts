// Starter phrases that beat the blank-page problem. Plain static data — no AI
// call, no cost, instant. Tagged by role group so they match the job
// categories JobsKart candidates actually apply to.
export interface PhraseGroup {
  id: string;
  label: string;
  summaries: string[];
  bullets: string[];
}

export const PHRASE_LIBRARY: PhraseGroup[] = [
  {
    id: 'general',
    label: 'General / Fresher',
    summaries: [
      'Hardworking and reliable fresher eager to learn quickly and contribute to a team from day one.',
      'Punctual, disciplined and quick to learn, with good communication skills and a positive attitude.',
    ],
    bullets: [
      'Completed all assigned tasks on time with attention to detail',
      'Worked well in a team and followed supervisor instructions',
      'Learned new tools and processes quickly with minimal training',
    ],
  },
  {
    id: 'warehouse',
    label: 'Warehouse & Logistics',
    summaries: [
      'Experienced warehouse associate skilled in picking, packing, loading and inventory handling with a strong safety record.',
    ],
    bullets: [
      'Picked, packed and dispatched **100+ orders daily** with high accuracy',
      'Loaded and unloaded goods safely using manual and mechanical handling',
      'Maintained stock records and reported shortages to the supervisor',
      'Kept the work area clean and followed all safety guidelines',
    ],
  },
  {
    id: 'driver',
    label: 'Driver & Delivery',
    summaries: [
      'Safe and punctual driver with a valid licence, good road knowledge and a clean driving record.',
    ],
    bullets: [
      'Delivered goods on time across the city with **zero major complaints**',
      'Maintained the vehicle, logbook and delivery records accurately',
      'Handled customer calls politely and resolved delivery issues quickly',
      'Followed traffic rules and safety norms on every trip',
    ],
  },
  {
    id: 'retail',
    label: 'Retail & Sales',
    summaries: [
      'Friendly sales executive with experience in customer handling, product knowledge and meeting monthly targets.',
    ],
    bullets: [
      'Achieved monthly sales targets through product knowledge and upselling',
      'Handled billing, cash and POS systems accurately',
      'Arranged displays and managed stock to keep the store customer-ready',
      'Built repeat customers through polite and helpful service',
    ],
  },
  {
    id: 'security',
    label: 'Security & Housekeeping',
    summaries: [
      'Alert and responsible staff member experienced in site safety, access control and maintaining clean, orderly premises.',
    ],
    bullets: [
      'Monitored entry and exit points and maintained visitor records',
      'Responded calmly to incidents and reported them promptly',
      'Maintained cleanliness standards across assigned areas',
      'Followed duty schedules and handed over shifts with clear notes',
    ],
  },
  {
    id: 'technician',
    label: 'Technician & Electrician',
    summaries: [
      'Skilled technician experienced in installation, maintenance and troubleshooting with strong attention to safety.',
    ],
    bullets: [
      'Installed, repaired and maintained equipment as per safety standards',
      'Diagnosed faults quickly and reduced repeat breakdowns',
      'Used hand tools, meters and testing equipment confidently',
      'Completed service jobs within the agreed time',
    ],
  },
  {
    id: 'office',
    label: 'Office & Customer Support',
    summaries: [
      'Organised office assistant with good communication, data entry and customer handling skills.',
    ],
    bullets: [
      'Handled customer calls and emails and resolved queries on first contact',
      'Entered and maintained records accurately in Excel and company software',
      'Prepared daily reports and followed up on pending tasks',
      'Coordinated with different teams to complete work on schedule',
    ],
  },
];
