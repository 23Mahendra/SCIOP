import { useEffect, useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Bell, Check, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Shell, PageHeading, Empty, Avatar, Tags } from '@/components/sciop/shell'
import { AuthPage } from '@/components/sciop/auth'
import { HomePage } from '@/components/sciop/feed'
import { RecordList, type RecordKind } from '@/components/sciop/records'
import { useSession, useWorkspace } from '@/components/sciop/session'
import { useCommit } from '@/components/sciop/actions'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'

export const Route = createFileRoute('/$path')({ component: PathPage })

function PathPage() {
  const { path } = Route.useParams()
  return <SCIOPPathPage path={path} />
}

export function SCIOPPathPage({ path }: { path: string }) {
  const { user } = useSession()
  const { data, isPending, error, refetch } = useWorkspace()
  const commit = useCommit()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedConversation, setSelectedConversation] = useState<string | null>(() => typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('conversation') : null)

  useEffect(() => {
    if (!selectedConversation && data?.conversations.length) setSelectedConversation(data.conversations[0].id)
  }, [data?.conversations, selectedConversation])

  const profile = data?.profiles.find(p => p.id === user?.id)
  const normalized = path.toLowerCase()
  const recordKinds: Record<string, RecordKind> = { opportunities: 'opportunities', projects: 'projects', ideas: 'ideas', communities: 'communities' }

  if (normalized === 'auth') return <AuthPage />
  if (normalized === 'reset') return <AuthPage reset />
  if (recordKinds[normalized]) return <Shell><RecordList kind={recordKinds[normalized]} /></Shell>
  if (normalized === 'home') return <Shell><HomePage /></Shell>

  if (normalized === 'explore') {
    const q = query.trim().toLowerCase()
    const people = (data?.profiles ?? []).filter(p => !p.is_suspended && (!q || [p.full_name,p.headline,p.bio,p.location,...p.domains,...p.skills].filter(Boolean).join(' ').toLowerCase().includes(q))).slice(0, 8)
    const records = [
      ...(data?.opportunities ?? []).map(r => ({ id:r.id, title:r.title, domain:r.domain, kind:'opportunities' as const })),
      ...(data?.projects ?? []).map(r => ({ id:r.id, title:r.title, domain:r.domain, kind:'projects' as const })),
      ...(data?.ideas ?? []).map(r => ({ id:r.id, title:r.title, domain:r.domain, kind:'ideas' as const })),
      ...(data?.communities ?? []).map(r => ({ id:r.id, title:r.name, domain:r.domain, kind:'communities' as const })),
    ].filter(r => !q || `${r.title} ${r.domain}`.toLowerCase().includes(q)).slice(0, 20)
    return <Shell><PageHeading eyebrow="DISCOVER" title="Explore SCIOP" description="Search across people, projects, ideas and opportunities."/><form className="global-search explore-search" onSubmit={e=>e.preventDefault()}><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Try a skill, domain, person or opportunity…" aria-label="Search all SCIOP"/><Button type="button" variant="ghost" onClick={()=>setQuery('')}>Clear</Button></form><section className="content-section"><h2>People</h2>{people.length?people.map(p=><article className="record-card" key={p.id}><Avatar name={p.full_name} url={p.avatar_url}/><div className="record-card-main"><h3><Link to="/people/$id" params={{id:p.id}}>{p.full_name}</Link></h3><p>{p.headline||p.account_type} · {p.location||'Location not set'}</p><Tags items={[...p.domains,...p.skills].slice(0,5)}/></div></article>):<Empty title="No matching people" description="Try another skill or domain."/>}</section><section className="content-section"><h2>Opportunities, projects, ideas and communities</h2>{records.length?records.map(r=><article className="record-card" key={r.kind+r.id}><div className="record-card-main"><span className="eyebrow">{r.kind}</span><h3>{r.kind==='communities'?<Link to="/communities/$id" params={{id:r.id}}>{r.title}</Link>:<Link to={`/${r.kind}/$id` as '/opportunities/$id'|'/projects/$id'|'/ideas/$id'} params={{id:r.id}}>{r.title}</Link>}</h3><p>{r.domain}</p></div><ArrowUpRight size={18}/></article>):<Empty title="Nothing matches yet" description="Try a broader search or publish the first opportunity."/>}</section></Shell>
  }

  if (normalized === 'people') {
    const people = (data?.profiles ?? []).filter(p => p.id !== user?.id && !p.is_suspended && `${p.full_name} ${p.headline||''} ${p.location||''} ${p.domains.join(' ')} ${p.skills.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    const connect = async (id:string) => {
      if (!user) { toast.info('Sign in to connect with members.'); return }
      const existing = data?.connections.find(c => (c.requester_id===user.id&&c.addressee_id===id)||(c.addressee_id===user.id&&c.requester_id===id))
      if (existing) { toast.info(`Connection status: ${existing.status}`); return }
      await commit(supabase.from('connections').insert({requester_id:user.id,addressee_id:id,status:'pending'}), 'Connection request sent')
    }
    return <Shell><PageHeading eyebrow="YOUR NETWORK" title="People" description="Meet people with complementary skills, interests and experience."/><div className="global-search explore-search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search names, skills and domains…" aria-label="Search people"/></div><section className="content-section">{people.length?people.map(p=>{const connection=data?.connections.find(c=>(c.requester_id===user?.id&&c.addressee_id===p.id)||(c.addressee_id===user?.id&&c.requester_id===p.id));return <article className="record-card" key={p.id}><Avatar name={p.full_name} url={p.avatar_url} size="large"/><div className="record-card-main"><h3><Link to="/people/$id" params={{id:p.id}}>{p.full_name}{p.is_verified?' ✓':''}</Link></h3><p>{p.headline||p.account_type} · {p.location||'Location not set'}</p>{p.bio&&<p>{p.bio}</p>}<Tags items={[...p.domains,...p.skills].slice(0,8)}/></div><Button variant="outline" onClick={()=>connect(p.id)} disabled={!!connection}><UserPlus size={16}/>{connection?connection.status:'Connect'}</Button></article>}) : <Empty title="No members found" description="Try a broader search or come back as the network grows."/>}</section></Shell>
  }

  if (normalized === 'profile' || normalized === 'settings') {
    if (!user) return <Shell><Empty title="Sign in to manage your profile" description="Create your SCIOP profile to make your skills and collaboration interests discoverable." action={<Button asChild><Link to="/auth">Join SCIOP</Link></Button>}/></Shell>
    if (!profile) return <Shell><PageHeading eyebrow="YOUR ACCOUNT" title="Your profile" description={isPending?'Loading your profile…':'Profile data is not available yet.'}/>{error&&<Button onClick={()=>refetch()}>Retry</Button>}</Shell>
    const saveProfile = async (e:FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const f=new FormData(e.currentTarget)
      await commit(supabase.from('profiles').update({
        full_name:String(f.get('full_name')).trim(),
        headline:String(f.get('headline')).trim(),
        bio:String(f.get('bio')).trim(),
        location:String(f.get('location')).trim(),
        website:String(f.get('website')).trim()||null,
        domains:String(f.get('domains')).split(',').map(x=>x.trim()).filter(Boolean),
        skills:String(f.get('skills')).split(',').map(x=>x.trim()).filter(Boolean),
        interests:String(f.get('interests')).split(',').map(x=>x.trim()).filter(Boolean),
        years_experience:Number(f.get('years_experience')||0),
      }).eq('id',user.id),'Profile saved')
    }
    return <Shell><PageHeading eyebrow="YOUR ACCOUNT" title={normalized==='settings'?'Profile settings':'Your profile'} description="Keep your expertise, interests and collaboration goals up to date."/><form className="stack-form profile-editor" onSubmit={saveProfile}><label>Full name<input name="full_name" required defaultValue={profile.full_name} maxLength={120}/></label><label>Professional headline<input name="headline" defaultValue={profile.headline||''} maxLength={180} placeholder="Architect · Researcher · Founder…"/></label><label>About you<textarea name="bio" rows={5} defaultValue={profile.bio||''} maxLength={5000}/></label><div className="form-grid"><label>Location<input name="location" defaultValue={profile.location||''} maxLength={150}/></label><label>Website / portfolio<input name="website" type="url" defaultValue={profile.website||''} placeholder="https://"/></label><label>Years of experience<input name="years_experience" type="number" min={0} max={80} defaultValue={profile.years_experience}/></label></div><label>Domains (comma separated)<input name="domains" defaultValue={profile.domains.join(', ')}/></label><label>Skills (comma separated)<input name="skills" defaultValue={profile.skills.join(', ')}/></label><label>Interests (comma separated)<input name="interests" defaultValue={profile.interests.join(', ')}/></label><Button type="submit">Save profile</Button></form></Shell>
  }

  if (normalized === 'messages') {
    if (!user) return <Shell><Empty title="Sign in to message" description="Connect with members to start a conversation." action={<Button asChild><Link to="/auth">Sign in</Link></Button>}/></Shell>
    const conversations=data?.conversations??[]
    const current=conversations.find(c=>c.id===selectedConversation)
    const messages=(data?.messages??[]).filter(m=>m.conversation_id===selectedConversation)
    const send=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!current)return;const f=new FormData(e.currentTarget);const content=String(f.get('content')).trim();if(!content)return;const ok=await commit(supabase.from('messages').insert({conversation_id:current.id,sender_id:user.id,content}),'Message sent');if(ok){e.currentTarget.reset();await queryClient.invalidateQueries({queryKey:['workspace']})}}
    return <Shell><PageHeading eyebrow="STAY CONNECTED" title="Messages" description="Keep conversations and collaboration moving."/><div className="messages-layout"><aside className="message-list">{conversations.map(c=><button type="button" className={selectedConversation===c.id?'message-thread active':'message-thread'} key={c.id} onClick={()=>setSelectedConversation(c.id)}><strong>{c.title||'Conversation'}</strong><small>{new Date(c.last_message_at).toLocaleDateString()}</small></button>)}{!conversations.length&&<Empty title="No conversations yet" description="Visit People and connect with someone to get started." action={<Button asChild><Link to="/people">Find people</Link></Button>}/>}</aside><section className="message-panel">{current?<><h2>{current.title||'Conversation'}</h2><div className="message-history">{messages.map(m=><article className={m.sender_id===user.id?'message-bubble own':'message-bubble'} key={m.id}><p>{m.content}</p><small>{new Date(m.created_at).toLocaleString()}</small></article>)}</div><form className="message-send" onSubmit={send}><input name="content" required maxLength={5000} placeholder="Write a message…" aria-label="Message"/><Button type="submit">Send</Button></form></>:<Empty title="Choose a conversation" description="Your selected conversation will appear here."/>}</section></div></Shell>
  }

  if (normalized === 'notifications') {
    if (!user) return <Shell><Empty title="Sign in to view notifications" action={<Button asChild><Link to="/auth">Sign in</Link></Button>}/></Shell>
    const notifications=data?.notifications??[]
    const markRead=async(id:string)=>{await commit(supabase.from('notifications').update({is_read:true}).eq('id',id).eq('user_id',user.id),'Notification marked read')}
    return <Shell><PageHeading eyebrow="YOUR ACTIVITY" title="Notifications" description="Updates about your connections and collaboration." action={<Button variant="outline" onClick={()=>commit(supabase.from('notifications').update({is_read:true}).eq('user_id',user.id),'All notifications marked read')}>Mark all read</Button>}/>{notifications.length?notifications.map(n=><article className={n.is_read?'record-card':'record-card notification-unread'} key={n.id}><Bell size={18}/><div className="record-card-main"><h3>{n.type.replace(/_/g,' ')}</h3><p>{n.body}</p><small>{new Date(n.created_at).toLocaleString()}</small></div>{!n.is_read&&<Button size="icon" variant="ghost" aria-label="Mark as read" onClick={()=>markRead(n.id)}><Check/></Button>}</article>):<Empty title="You’re all caught up" description="New activity will appear here." />}</Shell>
  }

  if (normalized === 'connections') {
    if (!user) return <Shell><Empty title="Sign in to view connections" action={<Button asChild><Link to="/auth">Sign in</Link></Button>}/></Shell>
    const connections=(data?.connections??[]).filter(c=>c.requester_id===user.id||c.addressee_id===user.id)
    return <Shell><PageHeading eyebrow="YOUR NETWORK" title="Connections" description="Manage invitations and professional relationships."/><section className="content-section">{connections.length?connections.map(c=>{const otherId=c.requester_id===user.id?c.addressee_id:c.requester_id;const p=data?.profiles.find(x=>x.id===otherId);return <article className="record-card" key={c.id}><Avatar name={p?.full_name||'SCIOP member'} url={p?.avatar_url}/><div className="record-card-main"><h3>{p?.full_name||'SCIOP member'}</h3><p>{p?.headline||p?.account_type} · {c.status}</p></div>{c.status==='pending'&&c.addressee_id===user.id&&<Button onClick={()=>commit(supabase.from('connections').update({status:'accepted'}).eq('id',c.id),'Connection accepted')}>Accept</Button>}</article>}) : <Empty title="Your network starts here" description="Find people with shared interests and complementary skills." action={<Button asChild><Link to="/people">Discover people</Link></Button>}/>}</section></Shell>
  }

  if (normalized === 'saved') return <Shell><PageHeading eyebrow="YOUR LIBRARY" title="Saved items" description="Keep useful opportunities and ideas close at hand."/><RecordList kind="opportunities" savedOnly/><RecordList kind="projects" savedOnly/><RecordList kind="ideas" savedOnly/><RecordList kind="communities" savedOnly/></Shell>

  if (normalized === 'admin') {
    const staff=data?.roles.some(r=>['admin','moderator'].includes(r.role))
    if (!staff) return <Shell><Empty title="Restricted area" description="Admin review is available to authorised moderators only."/></Shell>
    return <Shell><PageHeading eyebrow="TRUST & SAFETY" title="Admin review" description="Review reports and verification requests with appropriate staff permissions."/><AdminPanel/></Shell>
  }

  return <Shell><Empty title="Page not found" description="Choose a section from the SCIOP navigation." action={<Button asChild><Link to="/">Back home</Link></Button>}/></Shell>
}

function AdminPanel(){
 const {data:reports=[],isPending,error,refetch}=useQuery({queryKey:['sciop-admin-reports'],queryFn:async()=>{const {data,error}=await supabase.from('reports').select('*').order('created_at',{ascending:false}).limit(100);if(error)throw error;return data??[]}})
 const commit=useCommit()
 if(isPending)return <p>Loading reports…</p>
 if(error)return <div><p>Unable to load reports. Check staff RLS permissions.</p><Button onClick={()=>refetch()}>Retry</Button></div>
 return reports.length?<div className="content-section">{reports.map(r=><article className="record-card" key={r.id}><ShieldCheck size={18}/><div className="record-card-main"><h3>{r.item_type} · {r.reason||'No reason supplied'}</h3><p>Report ID: {r.id}</p><small>{new Date(r.created_at).toLocaleString()} · Status: {r.status}</small></div>{r.status!=='resolved'&&<Button variant="outline" onClick={()=>commit(supabase.from('reports').update({status:'resolved'}).eq('id',r.id),'Report marked resolved')}>Resolve</Button>}</article>)}</div>:<Empty title="No reports to review" description="New reports will appear here."/>
}
