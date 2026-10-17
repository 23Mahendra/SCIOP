import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/messages')({component:()=> <SCIOPPathPage path="messages"/>})