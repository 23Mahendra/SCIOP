import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient, queryOptions } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/integrations/supabase/client'
import { loadWorkspace } from '@/lib/sciop.functions'
export const workspaceOptions=queryOptions({queryKey:['workspace'],queryFn:()=>loadWorkspace(),staleTime:30000,retry:1})
const SessionContext=createContext<{user:User|null;ready:boolean}>({user:null,ready:false})
export function SessionProvider({children}:{children:ReactNode}) {
 const [user,setUser]=useState<User|null>(null);const [ready,setReady]=useState(false);const router=useRouter();const qc=useQueryClient()
 useEffect(()=>{let mounted=true; supabase.auth.getUser().then(({data})=>{if(mounted){setUser(data.user);setReady(true)}}).catch(()=>{if(mounted)setReady(true)})
 const {data}=supabase.auth.onAuthStateChange((event,session)=>{if(!['SIGNED_IN','SIGNED_OUT','USER_UPDATED','PASSWORD_RECOVERY'].includes(event))return;setUser(session?.user??null);setReady(true);router.invalidate();if(event!=='SIGNED_OUT')qc.invalidateQueries();})
 return ()=>{mounted=false;data.subscription.unsubscribe()}
 },[router,qc]);return <SessionContext.Provider value={{user,ready}}>{children}</SessionContext.Provider>
}
export const useSession=()=>useContext(SessionContext)
export function useWorkspace(){const {user}=useSession();return useQuery({...workspaceOptions,enabled:Boolean(user)})}
export function useRealtime(){const {user}=useSession();const qc=useQueryClient();useEffect(()=>{if(!user)return;const channel=supabase.channel(`sciop-${user.id}`).on('postgres_changes',{event:'*',schema:'public',table:'messages'},()=>qc.invalidateQueries({queryKey:['workspace']})).on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${user.id}`},()=>qc.invalidateQueries({queryKey:['workspace']})).subscribe();return ()=>{void supabase.removeChannel(channel)}},[user?.id,qc])}