import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/saved')({component:()=> <SCIOPPathPage path="saved"/>})