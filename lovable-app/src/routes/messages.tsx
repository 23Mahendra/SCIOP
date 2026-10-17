import { createFileRoute } from '@tanstack/react-router'
import { SCIOPPathPage } from './$path'
export const Route=createFileRoute('/messages')({
  validateSearch: (search: Record<string, unknown>) => ({
    conversation: typeof search.conversation === 'string' ? search.conversation : undefined,
  }),
  component:()=> <SCIOPPathPage path="messages"/>,
})