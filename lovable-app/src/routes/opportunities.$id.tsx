import { createFileRoute } from '@tanstack/react-router'
import { Shell } from '@/components/sciop/shell'
import { RecordDetail } from '@/components/sciop/records'
export const Route=createFileRoute('/opportunities/$id')({component:DetailPage})
function DetailPage(){const {id}=Route.useParams();return <Shell><RecordDetail kind="opportunities" id={id}/></Shell>}