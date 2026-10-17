import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/reset')({component:()=> <SCIOPPathPage path="reset"/>})