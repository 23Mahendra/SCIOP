import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '@/components/sciop/shell'
import { RecordDetail } from '@/components/sciop/records'
export const Route=createFileRoute('/communities/$id')({component:()=>{const {id}=Route.useParams();return <Shell><RecordDetail kind="communities" id={id}/></Shell>}})