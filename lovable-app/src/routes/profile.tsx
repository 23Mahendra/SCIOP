import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/profile')({component:()=> <SCIOPPathPage path="profile"/>})