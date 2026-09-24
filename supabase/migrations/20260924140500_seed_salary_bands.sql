-- Seed curated admin salary bands (Phase 5 of
-- salary-recommendation-engine-implementation.md) so the wizard's market
-- suggestion is useful on day one, before computed bands reach the minimum
-- sample size. National medians for common blue/grey-collar titles scaled by
-- a city cost-of-labour multiplier; p25/p75 derived as -10%/+15% of median,
-- min/max as -25%/+35%. All rounded to the nearest ₹100.
-- Re-runnable: ON CONFLICT DO NOTHING against the salary_bands unique index.

WITH titles(title_key, category, med) AS (
  VALUES
    ('delivery-executive',        'Delivery',          18000),
    ('driver',                    'Logistics',         20000),
    ('sales-executive',           'Sales',             22000),
    ('field-sales-officer',       'Sales',             20000),
    ('business-development-executive', 'Sales',        22000),
    ('telecaller',                'Customer Support',  17000),
    ('customer-support-executive','Customer Support',  20000),
    ('warehouse-associate',       'Warehouse',         16000),
    ('retail-sales-associate',    'Retail',            16000),
    ('store-manager',             'Retail',            25000),
    ('cashier',                   'Retail',            15000),
    ('housekeeper',               'Housekeeping',      13000),
    ('security-guard',            'Security',          15000),
    ('cook',                      'Hospitality',       18000),
    ('electrician',               'Technician',        22000),
    ('plumber',                   'Technician',        20000),
    ('mechanic',                  'Technician',        22000),
    ('carpenter',                 'Technician',        20000),
    ('data-entry-operator',       'Office Support',    16000),
    ('office-assistant',          'Office Support',    15000),
    ('receptionist',              'Office Support',    18000),
    ('accountant',                'Finance',           25000),
    ('hr-executive',              'HR',                25000),
    ('operations-manager',        'Operations',        35000),
    ('beautician',                'Beauty & Wellness', 18000),
    ('nurse',                     'Healthcare',        25000),
    ('teacher',                   'Education',         22000),
    ('graphic-designer',          'Design & Media',    25000),
    ('digital-marketing-executive','Marketing',        25000),
    ('software-engineer',         'IT & Software',     45000)
),
city_mults(city, mult) AS (
  VALUES
    ('Mumbai', 1.15), ('Delhi', 1.12), ('Bengaluru', 1.12), ('Hyderabad', 1.05),
    ('Pune', 1.00), ('Ahmedabad', 0.95), ('Surat', 0.95), ('Jaipur', 0.92),
    ('Lucknow', 0.90), ('Indore', 0.90), ('Nagpur', 0.90), ('Bhopal', 0.90),
    ('Ludhiana', 0.92), ('Kanpur', 0.88), ('Patna', 0.85)
)
INSERT INTO public.salary_bands
  (title_key, category, city, experience_bucket, pay_type,
   min_salary, p25, median_salary, p75, max_salary, sample_count, source)
SELECT
  t.title_key, t.category, c.city, 'any', 'fixed',
  round(t.med * c.mult * 0.75 / 100) * 100,
  round(t.med * c.mult * 0.90 / 100) * 100,
  round(t.med * c.mult / 100) * 100,
  round(t.med * c.mult * 1.15 / 100) * 100,
  round(t.med * c.mult * 1.35 / 100) * 100,
  0, 'admin'
FROM titles t CROSS JOIN city_mults c
ON CONFLICT (title_key, COALESCE(city, ''), COALESCE(state, ''), experience_bucket, pay_type, source)
DO NOTHING;
