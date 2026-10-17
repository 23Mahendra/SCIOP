import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/projects')({component:()=> <SCIOPPathPage path="projects"/>})