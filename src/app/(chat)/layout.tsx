import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ChatShell } from './chat-shell'

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return <ChatShell>{children}</ChatShell>
}
