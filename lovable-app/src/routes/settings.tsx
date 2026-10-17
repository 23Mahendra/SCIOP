import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/settings')({component:()=> <SCIOPPathPage path="settings"/>})