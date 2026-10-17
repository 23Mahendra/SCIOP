create type public.app_role as enum ('member','professional','organization','moderator','admin');

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at = now(); return new; end $$;

create table public.profiles (
  id uuid primary key,
  username text unique not null,
  full_name text not null default '',
  headline text default '',
  bio text default '',
  avatar_url text,
  cover_url text,
  location text default '',
  account_type text not null default 'member' check (account_type in ('member','professional','organization')),
  domains text[] not null default '{}',
  skills text[] not null default '{}',
  interests text[] not null default '{}',
  offers text[] not null default '{}',
  needs text[] not null default '{}',
  experience jsonb not null default '[]',
  education jsonb not null default '[]',
  portfolio jsonb not null default '[]',
  years_experience int not null default 0,
  website text default '',
  is_verified boolean not null default false,
  is_suspended boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role app_role not null,
  unique (user_id, role)
);
grant select, insert, update, delete on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;
create or replace function public.is_staff(_user_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role in ('admin','moderator'))
$$;

create policy "roles readable by self or staff" on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_staff(auth.uid()));
create policy "admins manage roles" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_staff(auth.uid()));

create or replace function public.guard_profile_flags() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.is_staff(auth.uid()) then
    new.is_verified := old.is_verified;
    new.is_suspended := old.is_suspended;
    new.is_demo := old.is_demo;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile_flags();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare base text; uname text; n int := 0; acct text;
begin
  base := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)), '[^a-zA-Z0-9_]', '', 'g'));
  if base = '' then base := 'user'; end if;
  uname := base;
  while exists(select 1 from public.profiles where username = uname) loop
    n := n + 1; uname := base || n::text;
  end loop;
  acct := coalesce(new.raw_user_meta_data->>'account_type','member');
  if acct not in ('member','professional','organization') then acct := 'member'; end if;
  insert into public.profiles(id, username, full_name, account_type, avatar_url)
  values (new.id, uname, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), acct, new.raw_user_meta_data->>'avatar_url');
  insert into public.user_roles(user_id, role) values (new.id, acct::app_role);
  if not exists(select 1 from public.user_roles where role='admin') then
    insert into public.user_roles(user_id, role) values (new.id, 'admin');
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.domains (id uuid primary key default gen_random_uuid(), name text unique not null, slug text unique not null);
create table public.skills (id uuid primary key default gen_random_uuid(), name text unique not null, domain text);
create table public.interests (id uuid primary key default gen_random_uuid(), name text unique not null);
grant select, insert, update, delete on public.domains to authenticated;
grant select, insert on public.skills, public.interests to authenticated;
grant all on public.domains, public.skills, public.interests to service_role;
alter table public.domains enable row level security;
alter table public.skills enable row level security;
alter table public.interests enable row level security;
create policy "read domains" on public.domains for select to authenticated using (true);
create policy "staff domains" on public.domains for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "read skills" on public.skills for select to authenticated using (true);
create policy "add skills" on public.skills for insert to authenticated with check (length(name) between 1 and 60);
create policy "read interests" on public.interests for select to authenticated using (true);
create policy "add interests" on public.interests for insert to authenticated with check (length(name) between 1 and 60);

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  domain text not null default '',
  description text default '',
  cover_url text,
  created_by uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','moderator','owner')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
grant select, insert, update, delete on public.communities, public.community_members to authenticated;
grant all on public.communities, public.community_members to service_role;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
create policy "read communities" on public.communities for select to authenticated using (true);
create policy "create communities" on public.communities for insert to authenticated with check (created_by = auth.uid());
create policy "edit communities" on public.communities for update to authenticated using (created_by = auth.uid() or public.is_staff(auth.uid()));
create policy "delete communities" on public.communities for delete to authenticated using (created_by = auth.uid() or public.is_staff(auth.uid()));
create policy "read members" on public.community_members for select to authenticated using (true);
create policy "join" on public.community_members for insert to authenticated with check (user_id = auth.uid());
create policy "leave" on public.community_members for delete to authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));

create table public.events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete cascade,
  title text not null,
  description text default '',
  starts_at timestamptz not null,
  location text default '',
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.events to authenticated;
grant all on public.events to service_role;
alter table public.events enable row level security;
create policy "read events" on public.events for select to authenticated using (true);
create policy "create events" on public.events for insert to authenticated with check (created_by = auth.uid());
create policy "manage events" on public.events for delete to authenticated using (created_by = auth.uid() or public.is_staff(auth.uid()));

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'text' check (type in ('text','image','video','link','question','poll','idea','project','opportunity','request')),
  content text not null default '',
  media_url text,
  link_url text,
  poll_options jsonb,
  community_id uuid references public.communities(id) on delete set null,
  ref_type text,
  ref_id uuid,
  shared_post_id uuid references public.posts(id) on delete set null,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.posts(created_at desc);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);
create table public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table public.poll_votes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_index int not null,
  primary key (post_id, user_id)
);
grant select, insert, update, delete on public.posts, public.comments, public.reactions, public.poll_votes to authenticated;
grant all on public.posts, public.comments, public.reactions, public.poll_votes to service_role;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reactions enable row level security;
alter table public.poll_votes enable row level security;
create policy "read posts" on public.posts for select to authenticated using (not is_hidden or author_id = auth.uid() or public.is_staff(auth.uid()));
create policy "create posts" on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy "update posts" on public.posts for update to authenticated using (author_id = auth.uid() or public.is_staff(auth.uid()));
create policy "delete posts" on public.posts for delete to authenticated using (author_id = auth.uid() or public.is_staff(auth.uid()));
create policy "read comments" on public.comments for select to authenticated using (true);
create policy "create comments" on public.comments for insert to authenticated with check (author_id = auth.uid());
create policy "delete comments" on public.comments for delete to authenticated using (author_id = auth.uid() or public.is_staff(auth.uid()));
create policy "read reactions" on public.reactions for select to authenticated using (true);
create policy "react" on public.reactions for insert to authenticated with check (user_id = auth.uid());
create policy "unreact" on public.reactions for delete to authenticated using (user_id = auth.uid());
create policy "read votes" on public.poll_votes for select to authenticated using (true);
create policy "vote" on public.poll_votes for insert to authenticated with check (user_id = auth.uid());
create policy "unvote" on public.poll_votes for delete to authenticated using (user_id = auth.uid());

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  message text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
grant select, insert, update, delete on public.follows, public.connections to authenticated;
grant all on public.follows, public.connections to service_role;
alter table public.follows enable row level security;
alter table public.connections enable row level security;
create policy "read follows" on public.follows for select to authenticated using (true);
create policy "follow" on public.follows for insert to authenticated with check (follower_id = auth.uid());
create policy "unfollow" on public.follows for delete to authenticated using (follower_id = auth.uid());
create policy "read own connections" on public.connections for select to authenticated using (requester_id = auth.uid() or addressee_id = auth.uid() or status = 'accepted');
create policy "request connection" on public.connections for insert to authenticated with check (requester_id = auth.uid());
create policy "respond connection" on public.connections for update to authenticated using (addressee_id = auth.uid());
create policy "remove connection" on public.connections for delete to authenticated using (requester_id = auth.uid() or addressee_id = auth.uid());
create trigger connections_touch before update on public.connections for each row execute function public.touch_updated_at();

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  title text,
  created_by uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  attachment_url text,
  attachment_name text,
  created_at timestamptz not null default now()
);
create index on public.messages(conversation_id, created_at);
grant select, insert, update on public.conversations, public.conversation_participants, public.messages to authenticated;
grant all on public.conversations, public.conversation_participants, public.messages to service_role;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

create or replace function public.is_participant(_conv uuid, _user uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.conversation_participants where conversation_id=_conv and user_id=_user)
$$;
create policy "read my conversations" on public.conversations for select to authenticated using (public.is_participant(id, auth.uid()));
create policy "read participants" on public.conversation_participants for select to authenticated using (public.is_participant(conversation_id, auth.uid()));
create policy "update my read state" on public.conversation_participants for update to authenticated using (user_id = auth.uid());
create policy "read messages" on public.messages for select to authenticated using (public.is_participant(conversation_id, auth.uid()));
create policy "send messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_participant(conversation_id, auth.uid()));

create or replace function public.get_or_create_dm(_other uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare cid uuid; me uuid := auth.uid();
begin
  if me is null or _other = me then raise exception 'invalid'; end if;
  select c.id into cid from public.conversations c
    join public.conversation_participants a on a.conversation_id=c.id and a.user_id=me
    join public.conversation_participants b on b.conversation_id=c.id and b.user_id=_other
    where c.is_group = false limit 1;
  if cid is null then
    insert into public.conversations(is_group, created_by) values (false, me) returning id into cid;
    insert into public.conversation_participants(conversation_id, user_id) values (cid, me), (cid, _other);
  end if;
  return cid;
end $$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('job','internship','freelance','business','partnership','investment','research','contract','vendor','mentorship')),
  title text not null,
  description text not null default '',
  domain text not null default '',
  skills text[] not null default '{}',
  location text default '',
  is_remote boolean not null default false,
  compensation text default '',
  min_experience int not null default 0,
  deadline date,
  status text not null default 'open' check (status in ('open','closed','filled')),
  community_id uuid references public.communities(id) on delete set null,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'apply' check (kind in ('apply','interest')),
  note text default '',
  status text not null default 'submitted' check (status in ('submitted','reviewing','shortlisted','accepted','rejected','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, applicant_id)
);
grant select, insert, update, delete on public.opportunities, public.applications to authenticated;
grant all on public.opportunities, public.applications to service_role;
alter table public.opportunities enable row level security;
alter table public.applications enable row level security;
create policy "read opps" on public.opportunities for select to authenticated using (not is_hidden or owner_id = auth.uid() or public.is_staff(auth.uid()));
create policy "create opps" on public.opportunities for insert to authenticated with check (owner_id = auth.uid());
create policy "update opps" on public.opportunities for update to authenticated using (owner_id = auth.uid() or public.is_staff(auth.uid()));
create policy "delete opps" on public.opportunities for delete to authenticated using (owner_id = auth.uid() or public.is_staff(auth.uid()));

create or replace function public.owns_opportunity(_opp uuid, _user uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.opportunities where id=_opp and owner_id=_user)
$$;
create policy "read applications" on public.applications for select to authenticated
  using (applicant_id = auth.uid() or public.owns_opportunity(opportunity_id, auth.uid()) or public.is_staff(auth.uid()));
create policy "apply" on public.applications for insert to authenticated with check (applicant_id = auth.uid());
create policy "update application" on public.applications for update to authenticated
  using (applicant_id = auth.uid() or public.owns_opportunity(opportunity_id, auth.uid()));
create policy "withdraw" on public.applications for delete to authenticated using (applicant_id = auth.uid());
create trigger applications_touch before update on public.applications for each row execute function public.touch_updated_at();

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  problem text not null default '',
  solution text not null default '',
  domain text not null default '',
  stage text not null default 'concept' check (stage in ('concept','planning','prototype','in_progress','launched','scaling')),
  budget text default '',
  timeline text default '',
  required_skills text[] not null default '{}',
  status text not null default 'open' check (status in ('open','closed','completed')),
  community_id uuid references public.communities(id) on delete set null,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  problem text not null default '',
  solution text not null default '',
  domain text not null default '',
  stage text not null default 'spark' check (stage in ('spark','research','validation','prototype','ready')),
  ip_status text not null default 'none' check (ip_status in ('none','confidential','patent_pending','patented','open_source')),
  collaboration_needs text default '',
  required_skills text[] not null default '{}',
  community_id uuid references public.communities(id) on delete set null,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.collaboration_requests (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('project','idea')),
  target_id uuid not null,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  message text default '',
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (target_type, target_id, requester_id)
);
grant select, insert, update, delete on public.projects, public.project_members, public.ideas, public.collaboration_requests to authenticated;
grant all on public.projects, public.project_members, public.ideas, public.collaboration_requests to service_role;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.ideas enable row level security;
alter table public.collaboration_requests enable row level security;
create policy "read projects" on public.projects for select to authenticated using (not is_hidden or owner_id = auth.uid() or public.is_staff(auth.uid()));
create policy "create projects" on public.projects for insert to authenticated with check (owner_id = auth.uid());
create policy "update projects" on public.projects for update to authenticated using (owner_id = auth.uid() or public.is_staff(auth.uid()));
create policy "delete projects" on public.projects for delete to authenticated using (owner_id = auth.uid() or public.is_staff(auth.uid()));
create or replace function public.owns_project(_p uuid, _user uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.projects where id=_p and owner_id=_user)
$$;
create policy "read project members" on public.project_members for select to authenticated using (true);
create policy "owner adds members" on public.project_members for insert to authenticated with check (public.owns_project(project_id, auth.uid()));
create policy "remove members" on public.project_members for delete to authenticated using (user_id = auth.uid() or public.owns_project(project_id, auth.uid()));
create policy "read ideas" on public.ideas for select to authenticated using (not is_hidden or owner_id = auth.uid() or public.is_staff(auth.uid()));
create policy "create ideas" on public.ideas for insert to authenticated with check (owner_id = auth.uid());
create policy "update ideas" on public.ideas for update to authenticated using (owner_id = auth.uid() or public.is_staff(auth.uid()));
create policy "delete ideas" on public.ideas for delete to authenticated using (owner_id = auth.uid() or public.is_staff(auth.uid()));
create policy "read collab" on public.collaboration_requests for select to authenticated using (requester_id = auth.uid() or owner_id = auth.uid());
create policy "request collab" on public.collaboration_requests for insert to authenticated with check (requester_id = auth.uid());
create policy "respond collab" on public.collaboration_requests for update to authenticated using (owner_id = auth.uid());
create policy "cancel collab" on public.collaboration_requests for delete to authenticated using (requester_id = auth.uid());

create or replace function public.project_owner_member() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.project_members(project_id,user_id,role) values (new.id,new.owner_id,'owner') on conflict do nothing; return new; end $$;
create trigger projects_owner_member after insert on public.projects for each row execute function public.project_owner_member();

create or replace function public.collab_accepted() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='accepted' and old.status <> 'accepted' and new.target_type='project' then
    insert into public.project_members(project_id,user_id,role) values (new.target_id,new.requester_id,'collaborator') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger collab_accept after update on public.collaboration_requests for each row execute function public.collab_accepted();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  type text not null,
  entity_type text,
  entity_id uuid,
  body text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.notifications(user_id, created_at desc);
create table public.saved_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_type text not null check (item_type in ('post','opportunity','project','idea','profile')),
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  item_type text not null,
  item_id uuid not null,
  reason text not null,
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz not null default now()
);
create table public.verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'identity',
  evidence text default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  check (author_id <> recipient_id)
);
grant select, insert, update, delete on public.notifications, public.saved_items, public.reports, public.verifications, public.recommendations to authenticated;
grant all on public.notifications, public.saved_items, public.reports, public.verifications, public.recommendations to service_role;
alter table public.notifications enable row level security;
alter table public.saved_items enable row level security;
alter table public.reports enable row level security;
alter table public.verifications enable row level security;
alter table public.recommendations enable row level security;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark notifications" on public.notifications for update to authenticated using (user_id = auth.uid());
create policy "delete notifications" on public.notifications for delete to authenticated using (user_id = auth.uid());
create policy "own saved" on public.saved_items for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "file report" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "read reports" on public.reports for select to authenticated using (reporter_id = auth.uid() or public.is_staff(auth.uid()));
create policy "staff update reports" on public.reports for update to authenticated using (public.is_staff(auth.uid()));
create policy "request verification" on public.verifications for insert to authenticated with check (user_id = auth.uid());
create policy "read verifications" on public.verifications for select to authenticated using (user_id = auth.uid() or public.is_staff(auth.uid()));
create policy "staff review verifications" on public.verifications for update to authenticated using (public.is_staff(auth.uid()));
create policy "read recs" on public.recommendations for select to authenticated using (true);
create policy "write recs" on public.recommendations for insert to authenticated with check (author_id = auth.uid());
create policy "delete recs" on public.recommendations for delete to authenticated using (author_id = auth.uid() or recipient_id = auth.uid());

create or replace function public.verification_reviewed() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='approved' and old.status<>'approved' then update public.profiles set is_verified=true where id=new.user_id; end if;
  return new;
end $$;
create trigger verification_review after update on public.verifications for each row execute function public.verification_reviewed();

create or replace function public.notify(_user uuid, _actor uuid, _type text, _etype text, _eid uuid, _body text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if _user is null or _user = _actor then return; end if;
  insert into public.notifications(user_id, actor_id, type, entity_type, entity_id, body) values (_user,_actor,_type,_etype,_eid,_body);
end $$;
revoke execute on function public.notify(uuid,uuid,text,text,uuid,text) from public, anon, authenticated;

create or replace function public.trg_follow() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.notify(new.following_id, new.follower_id, 'follow', 'profile', new.follower_id, 'started following you'); return new; end $$;
create trigger t_follow after insert on public.follows for each row execute function public.trg_follow();

create or replace function public.trg_connection() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then perform public.notify(new.addressee_id, new.requester_id, 'connection_request', 'profile', new.requester_id, 'sent you a connection request');
  elsif new.status='accepted' and old.status<>'accepted' then perform public.notify(new.requester_id, new.addressee_id, 'connection_accepted', 'profile', new.addressee_id, 'accepted your connection request');
  end if; return new; end $$;
create trigger t_connection after insert or update on public.connections for each row execute function public.trg_connection();

create or replace function public.trg_reaction() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.notify((select author_id from public.posts where id=new.post_id), new.user_id, 'like', 'post', new.post_id, 'liked your post'); return new; end $$;
create trigger t_reaction after insert on public.reactions for each row execute function public.trg_reaction();

create or replace function public.notify_mentions(_text text, _actor uuid, _etype text, _eid uuid) returns void
language plpgsql security definer set search_path=public as $$
declare m text;
begin
  for m in select distinct lower((regexp_matches(_text, '@([A-Za-z0-9_]+)', 'g'))[1]) loop
    perform public.notify((select id from public.profiles where username=m), _actor, 'mention', _etype, _eid, 'mentioned you');
  end loop;
end $$;
revoke execute on function public.notify_mentions(text,uuid,text,uuid) from public, anon, authenticated;

create or replace function public.trg_comment() returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.notify((select author_id from public.posts where id=new.post_id), new.author_id, 'comment', 'post', new.post_id, 'commented on your post');
  if new.parent_id is not null then
    perform public.notify((select author_id from public.comments where id=new.parent_id), new.author_id, 'reply', 'post', new.post_id, 'replied to your comment');
  end if;
  perform public.notify_mentions(new.content, new.author_id, 'post', new.post_id);
  return new; end $$;
create trigger t_comment after insert on public.comments for each row execute function public.trg_comment();

create or replace function public.trg_post() returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.notify_mentions(new.content, new.author_id, 'post', new.id);
  if new.shared_post_id is not null then
    perform public.notify((select author_id from public.posts where id=new.shared_post_id), new.author_id, 'share', 'post', new.id, 'shared your post');
  end if;
  return new; end $$;
create trigger t_post after insert on public.posts for each row execute function public.trg_post();

create or replace function public.trg_message() returns trigger language plpgsql security definer set search_path=public as $$
declare p record;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  update public.conversation_participants set last_read_at = new.created_at where conversation_id=new.conversation_id and user_id=new.sender_id;
  for p in select user_id from public.conversation_participants where conversation_id=new.conversation_id and user_id<>new.sender_id loop
    perform public.notify(p.user_id, new.sender_id, 'message', 'conversation', new.conversation_id, left(coalesce(nullif(new.content,''),'sent an attachment'),120));
  end loop;
  return new; end $$;
create trigger t_message after insert on public.messages for each row execute function public.trg_message();

create or replace function public.trg_application() returns trigger language plpgsql security definer set search_path=public as $$
declare o record;
begin
  select owner_id, title into o from public.opportunities where id=new.opportunity_id;
  if tg_op='INSERT' then
    perform public.notify(o.owner_id, new.applicant_id, 'application', 'opportunity', new.opportunity_id,
      case when new.kind='interest' then 'expressed interest in ' else 'applied to ' end || o.title);
  elsif new.status <> old.status then
    perform public.notify(new.applicant_id, o.owner_id, 'application_status', 'opportunity', new.opportunity_id, 'updated your application to "' || new.status || '" for ' || o.title);
  end if;
  return new; end $$;
create trigger t_application after insert or update on public.applications for each row execute function public.trg_application();

create or replace function public.trg_collab() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then perform public.notify(new.owner_id, new.requester_id, 'collaboration_request', new.target_type, new.target_id, 'wants to collaborate on your ' || new.target_type);
  elsif new.status<>old.status then perform public.notify(new.requester_id, new.owner_id, 'collaboration_' || new.status, new.target_type, new.target_id, new.status || ' your collaboration request');
  end if; return new; end $$;
create trigger t_collab after insert or update on public.collaboration_requests for each row execute function public.trg_collab();

create or replace function public.trg_opp_match() returns trigger language plpgsql security definer set search_path=public as $$
declare u record;
begin
  for u in select id from public.profiles p
    where p.id <> new.owner_id and cardinality(new.skills) > 0
      and (select count(*) from unnest(p.skills) s where lower(s) = any(select lower(x) from unnest(new.skills) x)) * 2 >= cardinality(new.skills)
    limit 20 loop
    perform public.notify(u.id, new.owner_id, 'match', 'opportunity', new.id, 'posted an opportunity that matches your skills: ' || new.title);
  end loop;
  return new; end $$;
create trigger t_opp_match after insert on public.opportunities for each row execute function public.trg_opp_match();

create or replace function public.overlap_ratio(a text[], b text[]) returns numeric language sql immutable set search_path=public as $$
  select case when coalesce(cardinality(b),0)=0 then 0 else
    (select count(distinct lower(x))::numeric from unnest(a) x where lower(x) in (select lower(y) from unnest(b) y)) / cardinality(b) end
$$;

create or replace function public.match_score(_user uuid, _skills text[], _domain text, _interests text[], _location text, _min_exp int) returns int
language sql stable security definer set search_path=public as $$
  select least(100, round(
      40 * public.overlap_ratio(p.skills, _skills)
    + 25 * (case when coalesce(_domain,'') <> '' and lower(_domain) = any(select lower(d) from unnest(p.domains) d) then 1 else 0 end)
    + 15 * public.overlap_ratio(p.interests || p.domains, _interests)
    + 10 * (case when coalesce(_location,'') <> '' and coalesce(p.location,'') <> '' and lower(p.location) like '%' || lower(trim(split_part(_location, ',', 1))) || '%' then 1 else 0 end)
    + 10 * (case when p.years_experience >= coalesce(_min_exp,0) then 1 else 0 end)
  ))::int from public.profiles p where p.id = _user
$$;

create or replace function public.matched_opportunities(_limit int default 10)
returns table(id uuid, title text, type text, domain text, location text, is_remote boolean, score int)
language sql stable security definer set search_path=public as $$
  select o.id, o.title, o.type, o.domain, o.location, o.is_remote,
    public.match_score(auth.uid(), o.skills, o.domain, o.skills, o.location, o.min_experience) as score
  from public.opportunities o
  where o.status='open' and not o.is_hidden and o.owner_id <> auth.uid()
  order by score desc, o.created_at desc limit _limit
$$;

create or replace function public.suggested_people(_limit int default 10)
returns table(id uuid, username text, full_name text, headline text, avatar_url text, location text, is_verified boolean, score int)
language sql stable security definer set search_path=public as $$
  with me as (select * from public.profiles where id = auth.uid())
  select p.id, p.username, p.full_name, p.headline, p.avatar_url, p.location, p.is_verified,
    least(100, round(
        35 * public.overlap_ratio(p.skills, me.needs || me.skills)
      + 25 * public.overlap_ratio(p.domains, me.domains)
      + 20 * public.overlap_ratio(p.interests, me.interests)
      + 10 * public.overlap_ratio(p.offers, me.needs)
      + 10 * (case when coalesce(me.location,'') <> '' and coalesce(p.location,'') <> '' and lower(trim(split_part(p.location,',',1))) = lower(trim(split_part(me.location,',',1))) then 1 else 0 end)
    ))::int as score
  from public.profiles p, me
  where p.id <> me.id and not p.is_suspended
    and not exists(select 1 from public.follows f where f.follower_id = me.id and f.following_id = p.id)
    and not exists(select 1 from public.connections c where (c.requester_id=me.id and c.addressee_id=p.id) or (c.addressee_id=me.id and c.requester_id=p.id))
  order by score desc, p.created_at desc limit _limit
$$;
grant execute on function public.match_score(uuid,text[],text,text[],text,int), public.matched_opportunities(int), public.suggested_people(int) to authenticated;

create or replace function public.admin_stats() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_staff(auth.uid()) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'users_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'posts', (select count(*) from public.posts),
    'opportunities', (select count(*) from public.opportunities),
    'applications', (select count(*) from public.applications),
    'projects', (select count(*) from public.projects),
    'ideas', (select count(*) from public.ideas),
    'communities', (select count(*) from public.communities),
    'messages', (select count(*) from public.messages),
    'connections', (select count(*) from public.connections where status='accepted'),
    'open_reports', (select count(*) from public.reports where status='open'),
    'pending_verifications', (select count(*) from public.verifications where status='pending')
  );
end $$;
grant execute on function public.admin_stats() to authenticated;

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;

create policy "media read authenticated" on storage.objects for select to authenticated using (bucket_id = 'media');
create policy "media upload own folder" on storage.objects for insert to authenticated with check (bucket_id='media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media delete own" on storage.objects for delete to authenticated using (bucket_id='media' and (storage.foldername(name))[1] = auth.uid()::text);

insert into public.domains(name, slug) values
 ('Technology','technology'),('Healthcare','healthcare'),('Climate & Energy','climate-energy'),('Finance','finance'),
 ('Education','education'),('Design','design'),('Science & Research','science-research'),('Agriculture','agriculture'),
 ('Manufacturing','manufacturing'),('Social Impact','social-impact'),('Media & Arts','media-arts'),('Legal & Policy','legal-policy');
insert into public.skills(name, domain) values
 ('React','Technology'),('Python','Technology'),('Machine Learning','Technology'),('Product Management','Technology'),
 ('UX Design','Design'),('Brand Strategy','Design'),('Data Analysis','Science & Research'),('Fundraising','Finance'),
 ('Financial Modeling','Finance'),('Clinical Research','Healthcare'),('Solar Engineering','Climate & Energy'),('Supply Chain','Manufacturing'),
 ('Copywriting','Media & Arts'),('Public Policy','Legal & Policy'),('Curriculum Design','Education'),('Agronomy','Agriculture');
insert into public.communities(slug, name, domain, description, is_demo) values
 ('climate-builders','Climate Builders','Climate & Energy','[Demo community] Founders, engineers and researchers building decarbonization solutions.', true),
 ('health-innovators','Health Innovators','Healthcare','[Demo community] Clinicians, technologists and researchers improving care.', true),
 ('ai-collective','AI Collective','Technology','[Demo community] Practitioners shipping applied AI across industries.', true),
 ('design-guild','Design Guild','Design','[Demo community] Product, brand and service designers sharing craft.', true);