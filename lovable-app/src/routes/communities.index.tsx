import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/communities/')({component:()=> <SCIOPPathPage path="communities"/>})