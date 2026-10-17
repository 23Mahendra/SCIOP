import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '@/components/sciop/shell'
import { PostDetail } from '@/components/sciop/feed'
export const Route=createFileRoute('/posts/$id')({component:()=>{const {id}=Route.useParams();return <Shell><PostDetail id={id}/></Shell>}})