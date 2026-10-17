import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/people/')({component:()=> <SCIOPPathPage path="people"/>})