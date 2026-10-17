import type { Tables } from '@/integrations/supabase/types'

export type Profile = Tables<'profiles'>
export const postTypes = ['text','image','video','link','question','poll','idea','project','opportunity','request'] as const
export const opportunityTypes = ['job','internship','freelance','business','partnership','investment','research','contract','vendor','mentorship'] as const
export const splitList = (value: string) => [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))]
export function matchFactors(profile: Profile | null | undefined, target: {skills?: string[]; required_skills?: string[]; domain?: string; location?: string | null; min_experience?: number}) {
  if (!profile) return {score: 0, factors: [] as string[]}
  const required = target.skills ?? target.required_skills ?? []
  const shared = required.filter(s => profile.skills.some(p => p.toLowerCase() === s.toLowerCase()))
  const domain = profile.domains.some(d => d.toLowerCase() === target.domain?.toLowerCase())
  const interest = required.filter(s => [...profile.interests,...profile.domains].some(p => p.toLowerCase()===s.toLowerCase()))
  const location = Boolean(target.location && profile.location && profile.location.toLowerCase().includes(target.location.split(',')[0].trim().toLowerCase()))
  const experience = profile.years_experience >= (target.min_experience ?? 0)
  const score = Math.min(100,Math.round((required.length ? 40*shared.length/required.length : 0)+(domain?25:0)+(required.length?15*interest.length/required.length:0)+(location?10:0)+(experience?10:0)))
  return {score, factors:[...(shared.length?[`Skills: ${shared.join(', ')} (40% weight)`]:[]),...(domain?['Shared domain (25% weight)']:[]),...(interest.length?['Shared interests (15% weight)']:[]),...(location?['Location alignment (10% weight)']:[]),...(experience?['Experience requirement met (10% weight)']:[])]}
}
export function metadata(title: string, description: string) {
  return {meta:[{title:`${title} · SCIOP`},{name:'description',content:description},{property:'og:title',content:`${title} · SCIOP`},{property:'og:description',content:description},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}
}