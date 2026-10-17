CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  username text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','professional','organization','moderator','admin')),
  account_type text NOT NULL DEFAULT 'individual',
  avatar_url text,
  cover_url text,
  bio text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  domains text[] NOT NULL DEFAULT '{}',
  skills text[] NOT NULL DEFAULT '{}',
  interests text[] NOT NULL DEFAULT '{}',
  experience text NOT NULL DEFAULT '',
  education text NOT NULL DEFAULT '',
  portfolio_url text NOT NULL DEFAULT '',
  can_offer text NOT NULL DEFAULT '',
  needs text NOT NULL DEFAULT '',
  verified boolean NOT NULL DEFAULT false,
  suspended boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_type text NOT NULL DEFAULT 'text' CHECK (post_type IN ('text','image','video','link','question','poll','idea','project','opportunity','request')),
  body text NOT NULL,
  media_url text,
  link_url text,
  title text NOT NULL DEFAULT '',
  poll_options jsonb,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','connections','community')),
  community_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reactions (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reaction text NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id, reaction)
);
CREATE TABLE IF NOT EXISTS follows (
  follower_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  followed_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);
CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','blocked')),
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> recipient_id),
  UNIQUE(requester_id, recipient_id)
);
CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('job','internship','freelance','business','partnership','investment','research','contract','vendor','mentorship','other')),
  description text NOT NULL,
  domain text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  work_mode text NOT NULL DEFAULT 'flexible',
  budget_min numeric,
  budget_max numeric,
  currency text NOT NULL DEFAULT 'INR',
  required_skills text[] NOT NULL DEFAULT '{}',
  deadline timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','paused','closed','filled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cover_note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','reviewing','shortlisted','accepted','rejected','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(opportunity_id, applicant_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text NOT NULL,
  problem text NOT NULL DEFAULT '',
  solution text NOT NULL DEFAULT '',
  domain text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'idea',
  budget text NOT NULL DEFAULT '',
  timeline text NOT NULL DEFAULT '',
  required_skills text[] NOT NULL DEFAULT '{}',
  collaboration_model text NOT NULL DEFAULT 'open',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','active','paused','completed','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'collaborator',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','declined','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,user_id)
);
CREATE TABLE IF NOT EXISTS ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  problem text NOT NULL,
  solution text NOT NULL DEFAULT '',
  domain text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'concept',
  ip_status text NOT NULL DEFAULT 'undisclosed',
  collaboration_needs text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'network' CHECK (visibility IN ('public','network','private')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  description text NOT NULL,
  domain text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community_members (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id,user_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct','group')),
  title text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id)
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id,user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  attachment_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  kind text NOT NULL,
  entity_type text NOT NULL DEFAULT '',
  entity_id uuid,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS saved_items (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('post','opportunity','project','idea','profile')),
  item_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,item_type,item_id)
);
CREATE TABLE IF NOT EXISTS collaboration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('project','idea','opportunity','profile')),
  target_id uuid NOT NULL,
  message text NOT NULL,
  proposed_model text NOT NULL DEFAULT 'open',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','actioned','dismissed')),
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE TABLE IF NOT EXISTS verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  document_ref text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,document_type)
);
CREATE TABLE IF NOT EXISTS domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  domain text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS profile_views (
  viewer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(viewer_id,profile_id),
  CHECK(viewer_id <> profile_id)
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_created ON opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_owner ON applications(applicant_id,created_at DESC);
INSERT INTO domains(name,description) VALUES
('AI & Machine Learning','Artificial intelligence, data and intelligent systems'),
('IT & Software','Software, web, mobile, cloud and security'),
('Architecture & Construction','Design, construction, project management and built environment'),
('Engineering & Manufacturing','Applied engineering, production and industrial technology'),
('Science & Research','Research, science and experimental development'),
('Energy & Sustainability','Renewables, climate and energy systems'),
('Education & Learning','Schools, institutions, skills and training'),
('Startups & Business','Entrepreneurship, operations, products and growth'),
('Health & Biotech','Healthcare and life sciences'),
('EV & Mobility','Electric vehicles, mobility and transport'),
('Mining & Critical Minerals','Mining, recovery and critical materials'),
('Design & Creative','Design, media, creative arts and content')
ON CONFLICT(name) DO NOTHING;
INSERT INTO skills(name,domain) VALUES
('Project Management','Architecture & Construction'),('UI/UX Design','IT & Software'),('Full-Stack Development','IT & Software'),
('AI/ML Engineering','AI & Machine Learning'),('Research & Analysis','Science & Research'),('Business Development','Startups & Business'),
('Architecture','Architecture & Construction'),('Civil Engineering','Engineering & Manufacturing'),('Marketing','Startups & Business'),
('Product Design','Design & Creative'),('Data Analysis','AI & Machine Learning'),('Technical Writing','Science & Research')
ON CONFLICT(name) DO NOTHING;
INSERT INTO communities(name,slug,description,domain) VALUES
('AI & Digital Systems','ai-digital-systems','Discuss applied AI, software, data systems and responsible digital innovation.','AI & Machine Learning'),
('Builders & Infrastructure','builders-infrastructure','Connect architects, engineers, contractors, planners and built-environment professionals.','Architecture & Construction'),
('Research & Innovation','research-innovation','Share research questions, ideas, technical challenges and collaboration opportunities.','Science & Research'),
('Founders & Business','founders-business','Explore venture ideas, business partnerships, customer needs and growth.','Startups & Business')
ON CONFLICT(name) DO NOTHING;
