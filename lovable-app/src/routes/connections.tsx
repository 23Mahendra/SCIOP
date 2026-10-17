import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/connections')({component:()=> <SCIOPPathPage path="connections"/>})