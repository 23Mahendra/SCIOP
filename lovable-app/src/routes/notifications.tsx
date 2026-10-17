import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/notifications')({component:()=> <SCIOPPathPage path="notifications"/>})