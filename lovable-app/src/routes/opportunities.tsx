import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/opportunities')({component:()=> <SCIOPPathPage path="opportunities"/>})