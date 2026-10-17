import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/ideas/')({component:()=> <SCIOPPathPage path="ideas"/>})