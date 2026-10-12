-- Seed data for the 16 role_category() departments so the feature works
-- immediately after deploy, before any admin edits a set in
-- src/routes/admin/quizzes.tsx. Five questions each, deliberately simple and
-- unambiguous (this is a basic-competency check, not a certification exam) —
-- an admin can rewrite any set at any time via admin_upsert_skill_quiz(),
-- which this seed also exercises as its insert path (ON CONFLICT DO NOTHING
-- here instead, since this only needs to run once; admin edits afterwards go
-- through the RPC, not this file).
INSERT INTO public.skill_quiz_question_sets (category, pass_mark, questions, is_active) VALUES
('Driver', 70, '[
  {"id":"q1","text":"What should you do first if your vehicle''s brakes feel weak?","options":["Keep driving and watch it","Stop and get it checked before continuing","Turn up the music","Drive faster to reach the mechanic sooner"],"correct":1},
  {"id":"q2","text":"A red traffic light means:","options":["Slow down only","Stop completely","Go if no one is around","Honk and proceed"],"correct":1},
  {"id":"q3","text":"Before starting a trip, you should check:","options":["Fuel, tyres and mirrors","Only fuel","Nothing, just start driving","Only the radio"],"correct":0},
  {"id":"q4","text":"If a passenger asks you to speed past the limit, you should:","options":["Agree immediately","Politely decline and drive within the limit","Argue loudly","Stop the vehicle and leave"],"correct":1},
  {"id":"q5","text":"A valid driving licence for the vehicle you drive is:","options":["Optional","Required by law","Only needed for long trips","Only needed at night"],"correct":1}
]'::jsonb, true),
('Delivery', 70, '[
  {"id":"q1","text":"A customer is not home when you arrive with their order. You should:","options":["Leave it at the door unattended always","Follow the app''s/employer''s delivery instructions (call, wait, or return)","Throw it away","Keep it for yourself"],"correct":1},
  {"id":"q2","text":"The best way to handle a fragile package is to:","options":["Toss it with other packages","Handle it carefully and keep it upright if marked so","Sit on it","Ignore any markings"],"correct":1},
  {"id":"q3","text":"If an order is damaged before you pick it up, you should:","options":["Deliver it anyway without saying anything","Report it before delivering","Hide the damage","Deliver it to a different address"],"correct":1},
  {"id":"q4","text":"Being polite and on-time with customers mainly helps:","options":["Only the company","Your own ratings and repeat business","No one","Only the customer"],"correct":1},
  {"id":"q5","text":"If you''re unsure of an address, the best first step is:","options":["Guess and deliver anywhere nearby","Use the map/app or call the customer to confirm","Return the order immediately without trying","Leave it at the first house you see"],"correct":1}
]'::jsonb, true),
('Security', 70, '[
  {"id":"q1","text":"If you notice an unknown person trying to enter without ID, you should:","options":["Let them in if they seem friendly","Stop them and verify identity per procedure","Ignore it","Follow them inside"],"correct":1},
  {"id":"q2","text":"During your shift, staying alert means:","options":["Sleeping is fine if quiet","Actively watching your assigned area","Leaving your post for long breaks","Using your phone the whole time"],"correct":1},
  {"id":"q3","text":"If you see a fire or smoke, the first step is usually to:","options":["Ignore it","Raise the alarm and follow the evacuation procedure","Wait and see what happens","Go investigate alone with no report"],"correct":1},
  {"id":"q4","text":"A visitor log/register is used to:","options":["Decoration only","Track who enters and exits for safety and accountability","Nothing important","Only for VIP guests"],"correct":1},
  {"id":"q5","text":"If a conflict breaks out between two people on site, your role is to:","options":["Join one side","De-escalate calmly and call for help/supervisor if needed","Walk away entirely","Record it for social media"],"correct":1}
]'::jsonb, true),
('Warehouse', 70, '[
  {"id":"q1","text":"Before lifting a heavy box, you should:","options":["Bend your back and lift fast","Bend your knees, keep your back straight, lift slowly","Ask someone else to always do it","Drag it on the floor"],"correct":1},
  {"id":"q2","text":"Items marked \"fragile\" should be:","options":["Stacked at the bottom with heavy items on top","Handled carefully and stored appropriately","Thrown onto the pile","Ignored"],"correct":1},
  {"id":"q3","text":"Keeping aisles clear in a warehouse mainly helps:","options":["Nothing","Safety and faster movement of goods","Only looks tidy","Slows down work"],"correct":1},
  {"id":"q4","text":"If a pallet or shelf looks unstable, you should:","options":["Use it anyway","Report it and avoid using it until fixed","Push it harder to test it","Ignore it"],"correct":1},
  {"id":"q5","text":"Checking stock counts against the system record is called:","options":["Guessing","Inventory/stock verification","Unnecessary work","Packing"],"correct":1}
]'::jsonb, true),
('Telecaller', 70, '[
  {"id":"q1","text":"When a customer sounds frustrated on a call, you should:","options":["Hang up","Stay calm, listen, and try to help","Argue back","Transfer without explanation"],"correct":1},
  {"id":"q2","text":"A good opening on a sales/support call usually includes:","options":["Greeting and stating your name/purpose clearly","Silence","Reading unrelated information","Shouting"],"correct":0},
  {"id":"q3","text":"If you don''t know the answer to a customer''s question, you should:","options":["Make up an answer","Say you''ll check and get back, or transfer appropriately","Hang up","Ignore the question"],"correct":1},
  {"id":"q4","text":"Noting down call details after a conversation is important because:","options":["It''s pointless","It helps future follow-up and record-keeping","Only managers need it","It wastes time"],"correct":1},
  {"id":"q5","text":"Speaking clearly and at a steady pace on calls mainly helps:","options":["Nothing","The customer understand you better","Only you","Make calls longer"],"correct":1}
]'::jsonb, true),
('Customer Support', 70, '[
  {"id":"q1","text":"A customer reports an issue with their order. The first step is usually to:","options":["Apologize and dismiss them","Listen fully and understand the issue before responding","Blame the customer","Ignore the complaint"],"correct":1},
  {"id":"q2","text":"If you cannot resolve an issue yourself, you should:","options":["Tell the customer it''s impossible and end the chat","Escalate to the right team/person","Ignore the ticket","Close it without a response"],"correct":1},
  {"id":"q3","text":"Responding to customers politely, even when they are upset, is:","options":["Not necessary","Important for good service","Only needed for important customers","Optional"],"correct":1},
  {"id":"q4","text":"Keeping a record of what was discussed with a customer helps:","options":["Nothing","Future reference and consistent support","Only the customer","Slows things down"],"correct":1},
  {"id":"q5","text":"If a customer asks for something outside policy, you should:","options":["Agree to anything to keep them happy","Explain the policy clearly and offer alternatives if possible","Ignore the request without reply","Argue with the customer"],"correct":1}
]'::jsonb, true),
('Data Entry', 70, '[
  {"id":"q1","text":"Before submitting a data entry task, you should:","options":["Submit immediately without checking","Double-check entries for accuracy","Skip difficult fields","Guess unclear values"],"correct":1},
  {"id":"q2","text":"If a source document is unclear or illegible, you should:","options":["Make up the data","Flag it or ask for clarification rather than guessing","Leave the whole row blank silently","Delete the record"],"correct":1},
  {"id":"q3","text":"Keeping consistent formatting (dates, names, numbers) across entries is:","options":["Not important","Important for accuracy and usability of the data","Only needed sometimes","Someone else''s job"],"correct":1},
  {"id":"q4","text":"If you notice a repeated error pattern in your work, you should:","options":["Ignore it and keep going","Correct it and inform your supervisor if needed","Hide it","Blame the source document only"],"correct":1},
  {"id":"q5","text":"Basic computer skills needed for data entry typically include:","options":["None needed","Typing accuracy and basic spreadsheet/software use","Only internet browsing","Graphic design"],"correct":1}
]'::jsonb, true),
('Housekeeping', 70, '[
  {"id":"q1","text":"When using cleaning chemicals, you should:","options":["Mix any chemicals together for faster results","Follow label instructions and never mix incompatible chemicals","Use as much as possible always","Ignore instructions"],"correct":1},
  {"id":"q2","text":"If you find a spill that could cause someone to slip, you should:","options":["Ignore it","Clean it up or mark/warn the area promptly","Walk around it and say nothing","Wait for someone else to notice"],"correct":1},
  {"id":"q3","text":"Wearing provided safety gear (gloves, etc.) while cleaning is:","options":["Optional, never needed","Important for your own safety","Only for show","Someone else''s responsibility"],"correct":1},
  {"id":"q4","text":"A consistent daily cleaning routine mainly helps:","options":["Nothing","Keep the area consistently clean and hygienic","Makes work harder","Is unnecessary"],"correct":1},
  {"id":"q5","text":"If cleaning equipment is damaged or not working, you should:","options":["Keep using it anyway","Report it and use an alternative if available","Hide it","Ignore the issue"],"correct":1}
]'::jsonb, true),
('Cook', 70, '[
  {"id":"q1","text":"Raw meat and ready-to-eat food should be:","options":["Stored together","Stored and prepared separately to avoid contamination","Mixed while cooking","It doesn''t matter"],"correct":1},
  {"id":"q2","text":"Washing hands before handling food is:","options":["Optional","Essential for hygiene and food safety","Only needed once a day","Not necessary"],"correct":1},
  {"id":"q3","text":"If food looks or smells spoiled, you should:","options":["Use it anyway to avoid waste","Discard it and not serve it","Mask the smell with spices","Serve it to staff instead"],"correct":1},
  {"id":"q4","text":"Keeping your cooking area clean while working helps:","options":["Nothing","Prevent contamination and accidents","Slows down cooking unnecessarily","Is someone else''s job"],"correct":1},
  {"id":"q5","text":"Checking that food is cooked to a safe temperature is important because:","options":["It isn''t important","It prevents foodborne illness","Only for special dishes","Only chefs need to worry about it"],"correct":1}
]'::jsonb, true),
('Field Agent', 70, '[
  {"id":"q1","text":"Before visiting a customer/site, you should:","options":["Show up without any plan","Confirm details and carry required documents/ID","Skip verifying the address","Go without informing anyone"],"correct":1},
  {"id":"q2","text":"If a customer refuses to cooperate during a visit, you should:","options":["Force the issue aggressively","Stay calm, explain the purpose, and follow escalation procedure if needed","Argue loudly","Leave without any record"],"correct":1},
  {"id":"q3","text":"Recording visit outcomes accurately is important because:","options":["It isn''t important","It ensures proper follow-up and accountability","Only for personal reference","It''s optional"],"correct":1},
  {"id":"q4","text":"Carrying your company ID during field visits is:","options":["Unnecessary","Important for verification and trust","Only needed for big accounts","Optional in most cases"],"correct":1},
  {"id":"q5","text":"Planning your route for multiple visits in a day helps:","options":["Nothing","Save time and cover more ground efficiently","Make the day longer","Is unnecessary"],"correct":1}
]'::jsonb, true),
('Retail', 70, '[
  {"id":"q1","text":"A customer wants to return an item. You should:","options":["Refuse immediately without checking policy","Check the store''s return policy and assist accordingly","Argue with the customer","Ignore the request"],"correct":1},
  {"id":"q2","text":"Keeping the store shelves neat and well-stocked mainly helps:","options":["Nothing","Customer experience and sales","Only looks nice","Slows down work"],"correct":1},
  {"id":"q3","text":"If the billing system shows a different price than the shelf tag, you should:","options":["Charge whichever is higher without checking","Verify and resolve the discrepancy fairly","Ignore it","Argue with the customer"],"correct":1},
  {"id":"q4","text":"Greeting customers and offering help when they enter is:","options":["Not necessary","Good customer service practice","Only for big stores","Optional and unimportant"],"correct":1},
  {"id":"q5","text":"Handling cash and billing accurately is important because:","options":["It isn''t important","Errors cause losses and customer trust issues","Only managers need to care","It''s someone else''s job"],"correct":1}
]'::jsonb, true),
('Sales', 70, '[
  {"id":"q1","text":"When a prospect raises an objection about price, a good approach is to:","options":["Immediately drop the price","Understand their concern and explain the value","Argue that they are wrong","End the conversation"],"correct":1},
  {"id":"q2","text":"Following up with a lead after the first conversation is:","options":["Unnecessary","Often important to closing a sale","Only needed for big deals","Annoying to the customer always"],"correct":1},
  {"id":"q3","text":"Understanding a customer''s actual needs before pitching is called:","options":["Guessing","Needs assessment/listening","Unimportant","Overselling"],"correct":1},
  {"id":"q4","text":"Making promises you can''t keep to close a sale is:","options":["A good strategy","A bad practice that damages trust and repeat business","Required for success","Harmless"],"correct":1},
  {"id":"q5","text":"Keeping track of your leads and follow-ups helps:","options":["Nothing","Stay organized and not miss opportunities","Slows you down","Only matters for managers"],"correct":1}
]'::jsonb, true),
('Nursing', 70, '[
  {"id":"q1","text":"Before giving any care to a patient, you should:","options":["Skip identity/consent checks","Confirm the patient''s identity and follow proper procedure","Guess the treatment needed","Act without informing anyone"],"correct":1},
  {"id":"q2","text":"Hand hygiene before and after patient contact is:","options":["Optional","Essential to prevent infection", "Only needed once a day","Not necessary"],"correct":1},
  {"id":"q3","text":"If a patient''s condition suddenly worsens, you should:","options":["Wait and observe only","Alert the responsible medical staff immediately","Handle it alone without informing anyone","Ignore it"],"correct":1},
  {"id":"q4","text":"Keeping accurate patient records is important because:","options":["It isn''t important","It ensures continuity and safety of care","Only for billing","It''s optional"],"correct":1},
  {"id":"q5","text":"Treating patients with respect and privacy is:","options":["Not required","A basic responsibility in caregiving","Only for certain patients","Optional based on mood"],"correct":1}
]'::jsonb, true),
('Teaching', 70, '[
  {"id":"q1","text":"If a student doesn''t understand a concept, a good teacher should:","options":["Move on regardless","Try a different explanation or example","Tell them to figure it out alone","Ignore the question"],"correct":1},
  {"id":"q2","text":"Preparing a lesson plan before class mainly helps:","options":["Nothing","Keep the class organized and on track","Make teaching harder","Is unnecessary"],"correct":1},
  {"id":"q3","text":"Treating all students fairly regardless of background is:","options":["Not necessary","An important responsibility","Only needed sometimes","Optional"],"correct":1},
  {"id":"q4","text":"Giving clear, constructive feedback on student work helps:","options":["Nothing","Students improve and understand mistakes","Discourage students always","Slow down the class"],"correct":1},
  {"id":"q5","text":"If a classroom becomes disruptive, a good first step is:","options":["Ignore it","Calmly address the behavior and redirect attention","Shout immediately","Stop teaching entirely"],"correct":1}
]'::jsonb, true),
('IT', 70, '[
  {"id":"q1","text":"If a user reports they can''t log in, a good first step is to:","options":["Assume it''s hopeless and escalate immediately","Check basic things like credentials/network before escalating","Ignore the ticket","Reset everything without checking"],"correct":1},
  {"id":"q2","text":"Keeping software and systems updated mainly helps with:","options":["Nothing important","Security and stability","Only cosmetic changes","Slowing down the system intentionally"],"correct":1},
  {"id":"q3","text":"Before making changes to a live/production system, you should:","options":["Just make the change directly","Test when possible and follow change procedures","Skip any review","Never document anything"],"correct":1},
  {"id":"q4","text":"Sharing passwords or credentials with others is:","options":["Fine if you trust them","Generally against good security practice","Required for teamwork","Encouraged"],"correct":1},
  {"id":"q5","text":"Documenting a fix after resolving an issue helps:","options":["Nothing","Future troubleshooting and knowledge sharing","Only the person who wrote it","Is a waste of time"],"correct":1}
]'::jsonb, true)
ON CONFLICT (category) DO NOTHING;
