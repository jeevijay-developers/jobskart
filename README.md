# JobsKart Connect

JobsKart — Complete Lovable Build Prompts

Phased Prompt Guide by Jeevijay Technologies

Brand Colors: Primary Blue #1A55BD | White #FFFFFF | Light Gray #F5F7FA | Dark Text #1A1A2E | Green Accent #16A34A Logo: JobsKart (use provided logo asset throughout) Reference UI: Apna.co style — clean white navbar, gradient hero sections, card-based layout, dual CTA buttons (Employer + Candidate), large search bar, trust logos

⚡ PHASE 1 — Design System + Landing Page (Homepage)

Build a modern Indian job portal homepage for "JobsKart" — a blue-collar and grey-collar hiring platform similar to Apna.co. Use the following exact design system throughout the entire project:

BRAND TOKENS:
- Primary Blue: #1A55BD
- Primary Dark: #1340A0
- White: #FFFFFF
- Light BG: #F5F7FA
- Dark Text: #1A1A2E
- Muted Text: #6B7280
- Success Green: #16A34A
- Border: #E5E7EB
- Card Shadow: 0 2px 12px rgba(26,85,189,0.08)
- Border Radius: 12px for cards, 8px for buttons, 24px for pills
- Font: Inter (primary), system-ui fallback
- Logo: "JobsKart" text with the double-arrow chevron icon in #1A55BD

NAVBAR (sticky, white background, light bottom border):
- Left: JobsKart logo (blue icon + bold "JobsKart" text)
- Center links: Jobs | For Employers | Candidates | Resources
- Right: "Employer Login" button (outlined, #1A55BD border) + "Candidate Login" button (solid #1A55BD fill, white text)
- Mobile: hamburger menu with slide-out drawer

HERO SECTION (full width, light gradient background — white to very light blue #EEF3FF, with a soft purple-to-green gradient blob on right side):
- Eyebrow label: "INDIA'S #1 BLUE COLLAR HIRING PLATFORM" in #1A55BD small caps
- H1 headline (bold 52px): "Your job search ends here"
- Subtext: "Discover 10 lakh+ career opportunities across India"
- Search bar (white card, soft shadow, pill-shaped, 3 fields inline):
  - Field 1: "Search jobs by title, skill..." with search icon
  - Field 2: "Your Experience" dropdown
  - Field 3: "Search for an area, city..." with location pin icon
  - Button: "Search Jobs" solid #1A55BD, white text, rounded right
- Below search: Popular tags as pill chips — "Work from Home", "Fresher Jobs", "Part Time", "Driver Jobs", "Security Guard", "Delivery Boy"
- Right side of hero: Hero image of a professional Indian person holding phone (use a placeholder rectangle for now)

TRUST SECTION (below hero, white bg):
- "Proud to Support" — government logo placeholders
- "Trusted by 1000+ Enterprises and 5 lakh+ MSMEs for hiring" — company logo placeholders (Tata, BigBasket, Blinkit, Reliance style)

POPULAR SEARCHES SECTION (light gray #F5F7FA background):
- Left: Big heading "Popular Searches on JobsKart" + "Hire the best talent or find your next opportunity"
- Right: 3x2 grid of category cards, each with:
  - "TRENDING AT #N" label in small muted text
  - Category name (bold 18px) e.g. "Jobs for Freshers", "Work from Home Jobs", "Part Time Jobs", "Driver Jobs", "Women Jobs", "Full Time Jobs"
  - "View all >" link in #1A55BD
  - Small illustrated image placeholder on right of card
  - Soft white card with subtle shadow

JOB CATEGORIES SECTION (white bg):
- Heading: "Browse Jobs by Category"
- Horizontal scrollable row of icon+label cards: Security, Driver, Delivery, Sales, Telecaller, Warehouse, Housekeeping, Cook, Retail, Field Agent, Nurse, Teacher — each card has a colored circle icon background and category name

HOW IT WORKS SECTION (light blue gradient bg #EEF3FF to #F0FDF4):
- Two columns — For Candidates | For Employers
- Each column has 3 numbered steps with icon, bold step name, description
- Candidates: 1. Create Profile → 2. Search & Apply → 3. Get Hired
- Employers: 1. Post a Job → 2. Review Candidates → 3. Hire Faster

STATS BANNER (dark blue #1A55BD background, white text):
- 4 stats in a row: "10 Lakh+ Jobs" | "50 Lakh+ Candidates" | "1000+ Employers" | "500+ Cities"

TESTIMONIALS SECTION (white bg):
- Heading: "What our users say"
- 3 cards with avatar placeholder, name, role, star rating, quote text

APP DOWNLOAD SECTION (gradient bg):
- "Download the JobsKart App" heading
- Google Play + App Store badge placeholders
- Phone mockup placeholder on right

FOOTER (dark #1A1A2E bg):
- Logo + tagline
- 4 link columns: For Candidates, For Employers, Company, Follow Us
- Bottom: copyright + privacy policy + terms

Make everything fully responsive — mobile first. All sections should have smooth hover states on cards and buttons. No dummy Lorem ipsum — use realistic Indian hiring context content.


⚡ PHASE 2 — Authentication System (Employer + Candidate)

Build a complete authentication system for JobsKart with two separate user types: Employer and Candidate. Keep the brand design system consistent (Primary Blue #1A55BD, white cards, Inter font, 12px card radius).

ROUTING STRUCTURE:
- /login → unified login page with tabs "I'm a Candidate" | "I'm an Employer"
- /signup/candidate → candidate registration
- /signup/employer → employer registration
- /forgot-password → OTP-based password reset

CANDIDATE LOGIN PAGE:
- Split layout: left half is brand illustration (light blue gradient with JobsKart logo, tagline "Find your dream job", 3 illustrated benefit points with icons)
- Right half: white card form
  - Heading: "Welcome back, Job Seeker"
  - Mobile number input (Indian +91 prefix) OR Email
  - OTP-based login option: "Send OTP" button
  - OR password field with show/hide toggle
  - "Login" CTA button (solid #1A55BD, full width)
  - Divider "OR" with line
  - "Continue with Google" button (white, outlined, Google icon)
  - Bottom: "New to JobsKart? Create Account" link
  - "Are you an employer? Employer Login →" link

CANDIDATE SIGNUP PAGE:
- Multi-step form (progress bar at top, 3 steps):
  Step 1 — Basic Info: Full Name, Mobile (+91), Email, Password, Confirm Password, "Send OTP" to verify mobile, City/Location (searchable dropdown with major Indian cities)
  Step 2 — Professional Info: Current Job Status (radio: Fresher / Experienced / Student), If experienced: Years of Experience (dropdown), Current/Last Job Role (text), Skills (multi-select pill chips — searchable, max 10), Preferred Job Type (checkboxes: Full Time, Part Time, Work from Home, Contract)
  Step 3 — Profile Photo: Upload photo (optional, with crop tool), Short bio (optional textarea), "Complete Profile" CTA
- Each step has a "Next →" and "← Back" button
- Show a completion % bar on the right side: "Profile Strength: 40%"

EMPLOYER REGISTRATION PAGE:
- Single page with sections:
  Section 1 — Admin Account: Full Name, Mobile (+91) with OTP verify, Work Email, Password, Confirm Password
  Section 2 — Company Details: Company Name, Company Type (dropdown: Proprietorship / Pvt Ltd / LLP / Public Ltd / NGO / Government), Industry (dropdown: searchable, 50+ industries), Company Size (dropdown: 1-10 / 11-50 / 51-200 / 201-500 / 500+), Website URL (optional), Company Logo Upload (optional), Company Description (textarea, max 500 chars)
  Section 3 — Hiring Location: Primary City (searchable), Pincode
- CTA: "Create Employer Account" (solid #1A55BD)
- Below: "By registering you agree to our Terms of Service and Privacy Policy" in small muted text
- Right panel (sticky): "Why post on JobsKart?" with 4 benefit points and trust badges

EMPLOYER LOGIN PAGE:
- Clean centered card (max 440px width)
- JobsKart logo at top
- Heading: "Employer Login"
- Email input
- Password with show/hide
- "Forgot Password?" link
- "Login to Dashboard" CTA
- Or "Login with OTP" toggle
- Bottom: "Don't have an account? Register your company →"

All auth forms must have:
- Real-time inline validation (red border + error message below field on blur)
- Loading spinner on submit button while processing
- Success toast notification on completion
- "Required field" indicators with asterisk
- Smooth transition animations between steps


⚡ PHASE 3 — Candidate Dashboard + Job Search

Build the complete Candidate Dashboard for JobsKart. After login, candidates land on their personalized dashboard. Keep consistent design: white bg, #1A55BD accents, card-based layout, Inter font.

CANDIDATE DASHBOARD LAYOUT:
- Left sidebar (240px, sticky): 
  - Profile avatar + name + "Profile Strength 65%" circular progress
  - Nav links with icons: Dashboard | Search Jobs | My Applications | Saved Jobs | Profile | Notifications | Logout
  - Bottom: "Download App" promo card
- Main content area (remaining width)
- Top header bar: "Good morning, [Name] 👋" + notification bell icon + city selector pill

DASHBOARD HOME:
- Welcome card (blue gradient): "5 new jobs matching your profile today" + "View Jobs" button
- Stats row (4 mini cards): Jobs Applied | Saved Jobs | Profile Views | Interview Calls
- "Recommended For You" section — horizontal scroll of Job Cards:
  Each Job Card (white, shadow, hover lift):
    - Company logo placeholder (colored initial circle)
    - Job Title (bold)
    - Company Name + Location chip (📍 Mumbai)
    - Salary range (₹15,000 - ₹22,000/month)
    - Job Type chip (Full Time / Part Time)
    - "Posted 2 days ago" in muted text
    - Tags: "Trending 🔥" or "Urgent ⚡" or "Featured ⭐"
    - Bottom row: Bookmark icon + "Apply Now" button
- "Complete Your Profile" nudge card (only if profile < 80%): Show missing items as checklist
- "Recently Viewed Jobs" horizontal scroll section

JOB SEARCH PAGE (/jobs):
- Full search bar at top (same 3-field bar from homepage)
- Left filter sidebar (260px):
  - Job Category (checkboxes with count badges)
  - Job Type (Full Time, Part Time, Work from Home, Freelance, Contract)
  - Experience Level (Fresher, 1-3 years, 3-5 years, 5+ years) — radio buttons
  - Salary Range (dual-handle range slider: ₹5,000 to ₹1,00,000)
  - Location (multi-city searchable select)
  - Date Posted (Today, Last 3 Days, Last Week, Last Month)
  - "Clear All Filters" link
- Right: Results area
  - Results count + Sort by dropdown (Relevance | Date | Salary High-Low | Salary Low-High)
  - Job cards in list view (same card design as above, slightly wider/horizontal)
  - Pagination at bottom (Previous | 1 2 3 ... | Next)
  - "No jobs found" empty state with illustration and "Broaden your search" suggestion

JOB DETAIL PAGE (/jobs/:id):
- Breadcrumb: Home > Jobs > [Category] > [Job Title]
- Top section: Company logo + Job Title (H1) + Company Name + Location + Posted Date
- Action bar: "Apply Now" (solid blue) + "Save Job" (outlined) + Share icon
- Tab navigation: Overview | Requirements | Company | Similar Jobs
- Overview tab content:
  - Key details row: Salary | Experience | Job Type | Openings | Work Schedule
  - "About this Job" section with formatted description
  - "Required Skills" as blue pill chips
  - "Perks & Benefits" icon list (PF, ESI, Incentives, Meals, etc.)
- Requirements tab: Education, Age criteria, Specific requirements
- Company tab: Company info, size, about, other open roles
- Similar Jobs tab: 6 similar job cards

MY APPLICATIONS PAGE:
- Tab bar: All | Applied | Shortlisted | Interview Scheduled | Rejected | Hired
- Table/list of applications:
  - Each row: Company logo | Job Title | Applied Date | Status chip (color coded) | "View" button
- Empty state for each tab with appropriate illustration

CANDIDATE PROFILE PAGE:
- Top card: Photo upload circle, Name, Current Status, Location, Edit button
- Profile Strength meter (horizontal progress bar with tip below)
- Sections (each editable inline):
  - Personal Info (Name, DOB, Gender, Mobile, Email, City, Pincode, Languages Known)
  - Professional Summary (textarea)
  - Work Experience (add multiple: Title, Company, Duration, Description)
  - Education (add multiple: Degree, Institute, Year, Score)
  - Skills (pill chips, add from searchable dropdown)
  - Preferred Job (Type, Category, Location, Salary expectation, Notice period)
  - Documents (Resume upload, Aadhaar upload optional)
- Each section has an "Edit" pencil icon → opens modal or inline editing

Make all pages mobile-responsive. On mobile, sidebar becomes bottom tab navigation.


⚡ PHASE 4 — Employer Dashboard + Smart Job Posting

Build the complete Employer Dashboard for JobsKart. This is the core employer experience with smart UX features inspired by AI-powered hiring platforms. Brand: #1A55BD primary, white cards, Inter font.

EMPLOYER DASHBOARD LAYOUT:
- Top navbar (white, shadow): JobsKart logo | "Dashboard" breadcrumb | Notification bell | Company name + logo pill | Avatar dropdown (Profile, Settings, Logout)
- Left sidebar (220px, collapsible):
  Nav items with icons:
  - 📊 Dashboard
  - ➕ Post a Job
  - 💼 My Jobs
  - 👥 Candidates
  - 🔓 DB Access
  - 📈 Analytics
  - 💳 Plans & Billing
  - 🏢 Company Profile
  - 👤 Team Members
  - ⚙️ Settings
- Main content (flex, remaining width)

EMPLOYER DASHBOARD HOME:
- Top greeting card (blue gradient): "Welcome back, [Name] — [Company Name]" + Verification badge if verified
- Quick stats row (5 cards):
  - Active Jobs | Total Applications | Candidates Unlocked | Boost Credits | Plan Expiry Date
- Quick Actions row (icon buttons): "Post New Job" | "Search Candidates" | "Buy Boost Credits" | "Upgrade Plan"
- "Your Active Jobs" section — table:
  Columns: Job Title | Type | Applications | Views | Status (Live/Paused/Expired) | Boost | Actions
- "Recently Applied Candidates" widget (last 5 applicants with quick Shortlist/Reject actions)
- "AI Insights" card (blue gradient, smaller): "3 candidates highly match your Sales Executive job — View Now"

JOB POSTING FLOW — SMART UX (Critical — AI-Powered):
Route: /employer/post-job
Multi-step form with PROGRESS HEADER (step indicator showing Step 1/4, 2/4 etc.)

STEP 1 — Job Basics (Smart Mapping):
- Job Title field:
  - As user types, show LIVE smart suggestion dropdown below (e.g., type "Sales" → shows "Sales Executive", "Sales Manager", "Sales Associate", "Field Sales Rep")
  - On selection, AUTO-FILL: Job Category, Sub-category, Work Type suggestions
- Job Category (auto-suggested, editable dropdown)
- Job Sub-Category (auto-suggested based on title)
- Number of Openings (number input, default 1)
- Job Type selector (pill toggle buttons — NOT radio buttons):
  [Full Time] [Part Time] [Contract] [Work from Home] [Internship]
- Work Schedule (pill toggles): [Day Shift] [Night Shift] [Rotational] [Flexible]
- Job Location:
  - City (searchable multi-select)
  - Locality/Area (appears after city selection)
  - "Work from Home" toggle that hides location fields if selected
- "Next →" button (solid #1A55BD)

STEP 2 — Requirements (Dynamic & Conditional):
- Experience Required:
  - Toggle: "Freshers Welcome" (if ON, experience fields hide dynamically)
  - If OFF: Min Experience (dropdown 0-10+ years) + Max Experience
- Education Required (dropdown): No Requirement / 10th Pass / 12th Pass / Graduate / Post Graduate
- Age Criteria (optional, show only if "Show Age Preference" toggle ON):
  - Min Age + Max Age (only appears when toggled — this is conditional form logic)
- Gender Preference (pill toggles): [Any] [Male] [Female]
- English Level (pill): [Not Required] [Basic] [Conversational] [Fluent]
- Skills Section (AI-powered):
  - Label: "Required Skills" with ✨ AI icon
  - Below job title selection, show: "Suggested Skills for [Job Title]:" with 8-10 pre-populated skill chips (blue outline) that recruiter can click to ADD
  - Also a search bar to add custom skills
  - Selected skills appear as solid blue chips with ✕ to remove
  - Show "Top industry-used skills" label above suggestions
- "← Back" + "Next →" buttons

STEP 3 — Compensation & Description:
- Salary Section:
  - Toggle: "Show Salary to Candidates" (YES/NO)
  - Salary Type: [Monthly] [Yearly] [Hourly] [Weekly]
  - Min Salary (number input) + Max Salary (number input)
  - SMART SUGGESTION BOX below salary fields (light blue card):
    "💡 Market Insight: For [Job Title] in [City], average salary is ₹18,000 - ₹25,000/month based on current JobsKart data"
    (This makes platform feel AI-powered)
  - Additional Benefits (checkboxes with icons): ✅ PF & ESIC | Incentives | Petrol Allowance | Meals Provided | Accommodation | Training Provided | Health Insurance | Laptop Provided
- Job Description Section:
  - Label: "Job Description" with "✨ Generate with AI" button (secondary, outlined)
  - Textarea (min 100 chars, max 2000 chars)
  - Below textarea: 3 template cards "Use Template": [Field Sales Template] [Telecaller Template] [Delivery Executive Template]
  - Clicking template auto-fills description which recruiter can edit
  - Character count display
- Interview Process (optional): [Walk-in Interview] [Video Call] [Telephonic] [On-site]
- "← Back" + "Next →" buttons

STEP 4 — Review & Publish:
- Full summary card showing all entered details
- JOB QUALITY SCORE WIDGET (critical feature from document):
  - Large circular progress/donut chart (0-100)
  - Score label: "Job Quality Score: 82/100 — Good"
  - Below: Checklist of optimization points:
    ✅ Job Title Added
    ✅ Salary Mentioned  
    ✅ Skills Added (5 skills)
    ✅ Description > 150 words
    ⚠️ No interview process selected — Add to improve by +8 pts
    ⚠️ No perks mentioned — Add benefits to improve by +5 pts
  - Color coding: green for done, orange for missing
  - "Improve your score" suggestion helps gamify the posting flow
- Job Type Selection (FINAL):
  Three cards side by side — user selects one:
  CARD 1 — "Classic Job" (white, outlined):
    - Icon: 📋
    - "Standard Job Posting"
    - "30 days active"
    - "Normal visibility"
    - "Available in all plans"
  CARD 2 — "Classic+ Job" (blue outlined, "Popular" badge):
    - Icon: ♻️
    - "Reusable Job Posting"
    - "30 days, can be reposted multiple times"
    - "Normal visibility"
    - "Available in Unlimited Plans only"
  CARD 3 — "Trending Job" (gold/amber outlined, "Premium" badge):
    - Icon: 🔥
    - "Maximum Visibility"
    - "30 days active"
    - "Higher ranking + premium placement"
    - "Consumes 1 Trending Job credit"
- Final CTAs: "Save as Draft" (outlined) | "Publish Job" (solid #1A55BD, large)
- After publish: Success animation + "Your job is now live!" confirmation card with share links

MY JOBS PAGE (/employer/jobs):
- Tabs: All | Live | Paused | Expired | Drafts
- Job list table with columns: Title | Type badge | Applied | Views | Posted Date | Expires | Boost Status | Actions (Edit, Pause/Resume, Boost, Delete)
- "Boost" button on each live job opens a BOOST MODAL:
  - Current boost credits available
  - Warning: "Cannot boost a job on the same day it goes live"
  - "Apply Boost" button (consumes 1 credit)
  - Boost history log for that job
  - Explanation: "Boosted jobs get temporary top-level visibility for the day"

Make this fully responsive. Use smooth step transitions in the job posting form.


⚡ PHASE 5 — Candidate DB Access + Job Responses + Recommendations

Build the Candidate DB Access module and Job Responses system for JobsKart employers. These are core monetization and hiring intelligence features.

DB ACCESS PAGE (/employer/candidates):
- Top bar: "Candidate Database" heading | "Active Job" selector dropdown (REQUIRED — must select a live job before searching — if no job selected, show a soft lock overlay with message "Please select an active live job to search candidates")
- If no live jobs exist: empty state card with "Post a Job First" CTA
- Search & Filters panel (left 280px):
  - Keyword search (name, skill, job title)
  - Experience Range (dual slider)
  - Education (multi-select)
  - Location (multi-city searchable)
  - Skills (multi-select pills)
  - Last Active (Today / Last 3 Days / Last Week / Last Month)
  - Candidate Tags filter: [Recommended] [Hot Profile] [Recently Active] [Fast Responder] [Nearby]
  - "Search" button (solid blue)
- Results area:
  - Results count: "Showing 47 candidates for Sales Executive in Mumbai"
  - Each candidate card (horizontal):
    LEFT: Blurred avatar + First name visible + Last name LOCKED (🔒 XXX)
    CENTER: 
      - Job Title (current/last)
      - Experience badge
      - Location chip
      - Education
      - Skills (3-4 chips)
      - "Last Active: 2 hours ago" 
      - Tags row: Recommended | Hot Profile | Nearby (colored chips)
    RIGHT:
      - Relevancy Score bar (e.g., "Match: 87%") with blue progress fill
      - "Unlock Profile" button (solid #1A55BD) — shows credits cost
      - "Save" bookmark icon
  - Locked data rule: Mobile number, email, full name are NEVER shown in frontend code until unlocked
  - After unlock: Full name + mobile + "Call Now" button + "WhatsApp" button appear
  - Unlock consumes 1 credit from the selected job's unlock quota (25 per job)
  - Show "Unlocked X/25 for this job" progress bar at top

JOB RESPONSES PAGE (/employer/jobs/:id/responses):
This is the candidate management view for a specific job. It has TWO TABS:

TAB 1 — "Applied Candidates":
- List of candidates who applied directly
- Same card design as above but fully visible (they applied so consent given)
- Status column: New | Reviewed | Shortlisted | Interview | Rejected | Hired
- Quick action buttons on each card: Shortlist | Schedule Interview | Reject | Message

TAB 2 — "AI Recommended Profiles" (Key feature — creates hiring intelligence feel):
- Header banner (blue gradient card):
  "🤖 AI is continuously matching profiles for this job — 12 new candidates found today"
  "Recommendations refresh dynamically based on market activity"
- Candidate cards with RECOMMENDATION TAGS:
  Each candidate shows 1-3 colored tag chips:
  [Recommended 🤖] [Hot Profile 🔥] [Recently Active ⚡] [Fast Responder ⚡] [Nearby 📍]
- SMART MESSAGING at top of section (rotates/updates):
  "💡 5 active candidates recently matched your profile"
  "💡 AI discovered 3 better matching profiles since yesterday"  
  "💡 New relevant candidates found — check now"
  (These messages make the platform feel alive and AI-driven)
- Candidates start UNLOCKED preview but mobile is locked until "Unlock Profile"
- Important: NEVER show "No Candidates Found" — if matches run low, system shows:
  "Showing 5 exact matches + 8 similar profiles from related roles"
  And display "Similar Profiles" section below with slightly broader matches
- Sort options: Best Match | Most Recent | Most Active | Nearby First

CANDIDATE DETAIL MODAL (opens on clicking any candidate card):
- Split modal (left = candidate info, right = actions)
- Left:
  - Profile photo (blurred if not unlocked)
  - Name (locked until unlocked)
  - Current/Last Role + Company
  - Full Skills list with proficiency
  - Experience timeline
  - Education details
  - Languages known
  - Location + distance from job location
  - "Relevant to your job because: Has 3 matching skills, Located nearby, Recently active"
- Right panel:
  - Relevancy score (large circle progress)
  - All candidate tags
  - "Unlock Profile" (if not unlocked) OR contact buttons (if unlocked)
  - Status change dropdown
  - Notes textarea for recruiter
  - "Add to Shortlist" button
  - Activity log: "Viewed by [Recruiter Name] on [Date]"

Important UX note: All candidate data beyond name/title must be fetched only AFTER unlock. Implement this with a locked state in UI.


⚡ PHASE 6 — Employer Verification + Team Management (Roles System)

Build the Employer Verification system and Multi-User Role Management for JobsKart.

COMPANY PROFILE & VERIFICATION PAGE (/employer/company):
- Top: Company logo (upload) + Company Name + Verification Status badge (Unverified / Verified ✅)
- Edit form for company details: Name, Type, Industry, Size, Description, Website, Social links
- "Hiring Locations" multi-city selector with pin icons

VERIFICATION SECTION (tabbed panel):
Tab 1 — GST Verification:
- Info card: "Verify your GST to build candidate trust and unlock premium features"
- Input: GST Number (15-digit format with mask)
- "Verify GST" button → Shows loading → Success/Error state
- On success: Show fetched company name, registered address, GST status as a green confirmation card
- "Verification Status: ✅ GST Verified — [Company Legal Name]"

Tab 2 — CIN Verification:
- Info card: "Corporate Identity Number verification via MCA records"
- Input: CIN Number (format: U12345AB1234PLC123456)
- "Verify CIN" → fetches MCA data → confirms company registration
- On success: Show company name, incorporation date, registered state

Tab 3 — Recruiter Aadhaar Verification:
- Info: "Verify your identity as the primary contact"
- Input: Aadhaar number (12 digits, masked)
- "Send OTP to linked mobile" → OTP input → Verify
- OR "Verify via DigiLocker" button (secondary option)
- On success: "Identity Verified ✅" badge on recruiter profile

TEAM MANAGEMENT PAGE (/employer/team):
- Header: "Manage Your Hiring Team" + "Add Member" button (solid blue)
- Role explanation cards at top (3 cards side by side):
  CARD 1 — "Super Admin" (crown icon, #1A55BD bg):
    "Full control — billing, jobs, team, verification, analytics"
  CARD 2 — "HR Admin" (shield icon, green bg):  
    "Manage hiring workflow, jobs, candidates, team"
  CARD 3 — "Recruiter" (person icon, gray bg):
    "Post jobs, search candidates, manage applications"

- Team members table:
  Columns: Avatar+Name | Email | Mobile | Role | Status (Active/Invited) | Last Active | Actions
  Each row actions: Edit Role (dropdown) | Remove (with soft-delete confirmation)

- "Invite Member" modal:
  - Email input
  - Role selector (HR Admin / Recruiter) — Super Admin cannot be assigned here
  - "Send Invite" button
  - Info: "They will receive an email invitation to join [Company Name] on JobsKart"

ACTIVITY TRACKER PAGE (/employer/activity):
- Heading: "Team Activity Log"
- Date range filter + Recruiter filter dropdown + Activity Type filter
- Activity log table:
  Columns: Timestamp | Team Member | Activity | Job/Candidate | Details
  Activity types tracked (color coded chips):
    🟢 Job Created | 🔵 Candidate Unlocked | 🟡 Boost Applied | 🟣 Candidate Contacted | ⚫ DB Search
- Export to CSV button

ROLE PERMISSIONS MATRIX (visible in Settings):
Display as a clean table:
Action | Super Admin | HR Admin | Recruiter
Create Recruiters | ✅ | ✅ | ❌
Manage Billing | ✅ | ⚠️ Limited | ❌
Post Jobs | ✅ | ✅ | ✅
Search Candidate DB | ✅ | ✅ | ✅
Unlock Candidates | ✅ | ✅ | ✅
Apply Boosts | ✅ | ✅ | ⚠️ Limited
Access Analytics | ✅ | ✅ | ⚠️ Limited
Company Verification | ✅ | ❌ | ❌
Create HR Admin | ✅ | ❌ | ❌
(Use green checkmark, red X, orange warning icons)

EDGE CASE UI HANDLING:
- When a recruiter is removed from team: Show toast "Recruiter access removed. Their personal JobsKart account remains active."
- When recruiter re-joins: "This recruiter already has a personal account — send them an invite to this organization"
- Multiple HR Admins: Allowed, show "Shared Admin Access" badge
- Recruiter role change: Show confirmation modal "Changing [Name] from Recruiter to HR Admin will grant them access to team management. Confirm?"


⚡ PHASE 7 — Plans, Billing + Analytics Dashboard

Build the Plans & Billing system and Analytics Dashboard for JobsKart employers.

PLANS PAGE (/employer/plans):
- Heading: "Choose the Right Plan for Your Hiring Needs"
- Toggle: [Monthly] [Quarterly] [Annual] (Annual shows "Save 30%" badge)
- 3 plan cards (white cards, hover lift, most popular highlighted in blue):
  
  BASIC PLAN (white card):
    - "Basic" label
    - Price: ₹1,999/month
    - Subtitle: "For small businesses & occasional hiring"
    - Features list (checkmarks):
      ✅ 5 Active Job Posts
      ✅ 25 Candidate Unlocks/job
      ✅ Classic Job Posts only
      ✅ Email Support
      ❌ No Boost Credits
      ❌ No Trending Jobs
      ❌ No Team Members
    - "Get Started" button (outlined blue)
  
  PRO PLAN (blue card, "Most Popular" badge):
    - "Pro" label
    - Price: ₹4,999/month
    - Subtitle: "For growing companies with active hiring"
    - Features list:
      ✅ 25 Active Job Posts
      ✅ 25 Candidate Unlocks/job
      ✅ Classic + Classic+ Posts
      ✅ 5 Boost Credits/month
      ✅ 3 Trending Job Posts
      ✅ Up to 3 Team Members
      ✅ Basic Analytics
      ✅ Priority Support
    - "Get Started" button (solid white, blue text — inverse on blue card)
  
  UNLIMITED PLAN (dark card #1A1A2E):
    - "Unlimited" label
    - Price: ₹9,999/month
    - Subtitle: "For enterprises with continuous hiring needs"
    - Features list (all green):
      ✅ Unlimited Job Posts
      ✅ Classic+ reusable posts (unlimited repost)
      ✅ 25 Candidate Unlocks/job
      ✅ 20 Boost Credits/month
      ✅ 10 Trending Job Credits
      ✅ Unlimited Team Members
      ✅ Advanced Analytics
      ✅ Dedicated Account Manager
      ✅ GST/CIN Verification Support
    - "Contact Sales" button (white on dark)

- Below plans: "Add-on Credits" section:
  Buy additional boost credits: ₹199/credit (min 5 credits)
  Buy additional trending job credits: ₹499/credit
  Buy additional unlock credits: ₹99/unlock

- Current plan status banner (if already subscribed): 
  "Your Pro Plan is active until 15 Aug 2025 — 18 days remaining — Renew Now"

BILLING HISTORY TABLE:
- Columns: Invoice # | Date | Plan/Product | Amount | Status | Download Invoice
- Download as PDF button per row

ANALYTICS DASHBOARD (/employer/analytics):
- Date range picker (Last 7 Days / Last 30 Days / Custom)
- OVERVIEW METRICS ROW (5 stat cards):
  Total Job Views | Total Applications | Candidates Unlocked | Boost Uses | Profile Conversion Rate

- CHARTS SECTION:
  Chart 1 — "Applications Over Time" (line chart, blue line):
    X-axis: dates, Y-axis: application count
    Show per-job filtering in legend
  
  Chart 2 — "Top Performing Jobs" (horizontal bar chart):
    Job titles on Y-axis, application count on X-axis
    Color coded by job type (Classic / Trending)
  
  Chart 3 — "Candidate Source Breakdown" (donut/pie chart):
    "Applied Directly" vs "AI Recommended" vs "DB Search Unlocked"
  
  Chart 4 — "Application Status Funnel" (funnel chart):
    Applied → Reviewed → Shortlisted → Interviewed → Hired

- TEAM PERFORMANCE TABLE (visible to Super Admin and HR Admin only):
  Member Name | Jobs Posted | Candidates Unlocked | Shortlisted | Hired

- RECOMMENDATIONS INSIGHT WIDGET:
  "🤖 AI Recommendation Performance"
  "32 candidates recommended → 12 unlocked → 4 shortlisted → 1 hired"
  "Your recommendation conversion: 12.5% (Industry avg: 8%)"


⚡ PHASE 8 — Final Polish, Notifications + Mobile Optimization

Final phase — polish the entire JobsKart platform with notifications, mobile optimizations, and micro-interactions.

NOTIFICATION SYSTEM:
- Bell icon in navbar shows unread count badge (red dot with number)
- Notification dropdown (380px wide panel):
  - Tabs: All | Jobs | Applications | System
  - Each notification item: colored left border (blue=jobs, green=applications, orange=system) + icon + title + time ago + "Mark read" on hover
  - Employer notifications: "New application for Sales Executive — Rahul S.", "Your Job Quality Score improved to 88", "Boost applied successfully to Driver Job", "New team member Priya joined as Recruiter"
  - Candidate notifications: "Your application was viewed by TechCorp", "New job matching your profile in Mumbai", "Your profile was unlocked by an employer", "Interview call scheduled"
  - "Mark All Read" button at top
  - "See All Notifications" link at bottom
- Full notifications page (/notifications) with same tab layout in full page

EMAIL NOTIFICATION TRIGGERS (show in settings as toggleable):
Employer: New Application Received | Weekly Hiring Summary | Plan Expiry Reminder | Boost Credit Low
Candidate: Application Status Change | New Job Match | Profile View | Interview Scheduled

MOBILE OPTIMIZATIONS:
- Candidate mobile app-feel: Bottom tab navigation (Home | Search | Applications | Profile)
- Employer mobile: Collapsible sidebar → hamburger → slide-out drawer
- All cards touchable with proper tap targets (min 44px)
- Swipe actions on application cards (swipe left = reject, swipe right = shortlist)
- Thumb-friendly: primary CTA buttons pinned to bottom on mobile forms

MICRO-INTERACTIONS & POLISH:
- Job Quality Score donut animates from 0 to score value on page load
- Skill chips animate in with stagger when AI suggests them
- Application status updates with optimistic UI (instant color change, confirm in background)
- "Unlock Profile" button has a keyhole icon that animates unlock when clicked
- Page transitions: subtle fade+slide between dashboard sections
- Loading skeletons (gray animated shimmer) instead of spinners for list pages
- Empty states: illustrated SVG with friendly message and clear CTA for every empty list/section
- Toast notifications (bottom-right): Success (green) | Error (red) | Info (blue) | Warning (orange)
- Tooltips on icon-only buttons

SEARCH & SEO (Landing page):
- Semantic HTML with proper H1, H2, H3 hierarchy
- Meta tags for each major page
- Sitemap-ready URL structure: /jobs, /jobs/[city], /jobs/[category], /employer

SETTINGS PAGE (/settings):
- Account Settings: Change password, Update phone, Update email (with OTP verification)
- Notification Preferences: Toggle email/SMS for each notification type
- Privacy Settings (Candidate): "Who can see my profile" (Everyone / Employers only / Hidden)
- For Employers: Danger zone — "Deactivate Company Account" with confirmation flow

FINAL CHECKLIST TO VERIFY:
- All forms have proper validation
- All API-connected sections have loading + error + empty states
- Role-based UI: Recruiter cannot see billing/team pages (show 403 page with "Ask your Super Admin" message)
- "Locked data" (mobile, email) never appears in page source until unlock API call
- Responsive on: 320px, 375px, 768px, 1024px, 1440px
- Consistent use of #1A55BD, white, #F5F7FA, #1A1A2E across all pages
- JobsKart logo appears in: Navbar, Auth pages, Email templates, Footer
- All currency in Indian Rupee ₹ format
- All numbers in Indian format (lakhs, crores — e.g., "5 lakh candidates")


📋 QUICK REFERENCE — Page Routes

Route Page / Homepage / Landing /login Unified Login /signup/candidate Candidate Registration /signup/employer Employer Registration /jobs Job Search /jobs/:id Job Detail /candidate/dashboard Candidate Home /candidate/applications My Applications /candidate/profile Candidate Profile /employer/dashboard Employer Home /employer/post-job Post New Job /employer/jobs My Jobs /employer/jobs/:id/responses Job Responses + AI Recommended /employer/candidates Candidate DB Search /employer/team Team Management /employer/activity Activity Tracker /employer/company Company Profile + Verification /employer/plans Plans & Billing /employer/analytics Analytics Dashboard /notifications All Notifications /settings Account Settings

🎨 Design Token Quick Reference (paste at start of every prompt)

Primary Blue: #1A55BD
Primary Dark: #1340A0
Primary Light: #EEF3FF
White: #FFFFFF
Light BG: #F5F7FA
Border: #E5E7EB
Dark Text: #1A1A2E
Muted: #6B7280
Green: #16A34A
Green Light: #F0FDF4
Amber: #D97706
Red: #DC2626
Font: Inter
Card Radius: 12px
Button Radius: 8px
Card Shadow: 0 2px 12px rgba(26,85,189,0.08)

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
