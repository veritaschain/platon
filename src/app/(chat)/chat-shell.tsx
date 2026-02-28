'use client'

import { createContext, useContext, useState } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'

interface SidebarContextValue {
  openSidebar: () => void
}

const SidebarContext = createContext<SidebarContextValue>({ openSidebar: () => {} })
export const useSidebarContext = () => useContext(SidebarContext)

export function ChatShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <SidebarContext.Provider value={{ openSidebar: () => setMobileOpen(true) }}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Desktop sidebar */}
        <Sidebar />
        {/* Mobile sidebar overlay */}
        <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
        <main className="flex-1 flex flex-col h-full overflow-hidden">
          {children}
        </main>
      </div>
    </SidebarContext.Provider>
  )
}
