import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/auth')({component:()=> <SCIOPPathPage path="auth"/>})