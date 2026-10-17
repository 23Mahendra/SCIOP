import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/explore')({component:()=> <SCIOPPathPage path="explore"/>})