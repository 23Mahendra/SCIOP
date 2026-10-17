import { createServerFn } from '@tanstack/react-start'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'

export const loadWorkspace = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async ({context}) => {
  const db=context.supabase
  const results=await Promise.all([
    db.from('profiles').select('*').limit(200),db.from('posts').select('*').order('created_at',{ascending:false}).limit(100),
    db.from('opportunities').select('*').order('created_at',{ascending:false}).limit(100),db.from('projects').select('*').order('created_at',{ascending:false}).limit(100),
    db.from('ideas').select('*').order('created_at',{ascending:false}).limit(100),db.from('communities').select('*').limit(100),
    db.from('comments').select('*').order('created_at').limit(500),db.from('reactions').select('*').limit(1000),db.from('saved_items').select('*').eq('user_id',context.userId),
    db.from('follows').select('*').eq('follower_id',context.userId),db.from('connections').select('*').or(`requester_id.eq.${context.userId},addressee_id.eq.${context.userId}`),
    db.from('applications').select('*').limit(200),db.from('collaboration_requests').select('*').limit(200),db.from('community_members').select('*').limit(1000),
    db.from('project_members').select('*').limit(500),db.from('notifications').select('*').order('created_at',{ascending:false}).limit(100),
    db.from('conversations').select('*').order('last_message_at',{ascending:false}).limit(100),db.from('conversation_participants').select('*').limit(500),
    db.from('messages').select('*').order('created_at').limit(1000),db.from('user_roles').select('*').eq('user_id',context.userId),
    db.from('domains').select('*'),db.from('skills').select('*'),db.from('poll_votes').select('*').limit(1000),db.from('verifications').select('*').limit(100),
  ])
  const error=results.find(r=>r.error)?.error
  if(error) throw new Error('SCIOP could not connect to your data. Please try again shortly.')
  const [profiles,posts,opportunities,projects,ideas,communities,comments,reactions,saved,follows,connections,applications,collaborations,members,projectMembers,notifications,conversations,participants,messages,roles,domains,skills,votes,verifications]=results
  return {userId:context.userId,profiles:profiles.data??[],posts:posts.data??[],opportunities:opportunities.data??[],projects:projects.data??[],ideas:ideas.data??[],communities:communities.data??[],comments:comments.data??[],reactions:reactions.data??[],saved:saved.data??[],follows:follows.data??[],connections:connections.data??[],applications:applications.data??[],collaborations:collaborations.data??[],members:members.data??[],projectMembers:projectMembers.data??[],notifications:notifications.data??[],conversations:conversations.data??[],participants:participants.data??[],messages:messages.data??[],roles:roles.data??[],domains:domains.data??[],skills:skills.data??[],votes:votes.data??[],verifications:verifications.data??[]}
})
export const loadAdmin = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async ({context})=>{
  const staff=await context.supabase.rpc('is_staff',{_user_id:context.userId})
  if(!staff.data) throw new Error('You do not have permission to access moderation.')
  const [stats,reports,verifications]=await Promise.all([context.supabase.rpc('admin_stats'),context.supabase.from('reports').select('*').order('created_at',{ascending:false}),context.supabase.from('verifications').select('*').order('created_at',{ascending:false})])
  if(stats.error||reports.error||verifications.error) throw new Error('Unable to load moderation data.')
  return {stats:stats.data,reports:reports.data??[],verifications:verifications.data??[]}
})