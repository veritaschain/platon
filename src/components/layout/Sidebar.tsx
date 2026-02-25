'use client'

import { useEffect, useState } from 'react'
import { useRoomStore } from '@/stores/room-store'
import { Button } from '@/components/common/Button'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const { rooms, activeRoomId, isLoading, fetchRooms, createRoom, selectRoom } = useRoomStore()
  const router = useRouter()

  useEffect(() => { fetchRooms() }, [])

  const handleCreateRoom = async () => {
    const room = await createRoom()
    if (room?.id) router.push('/')
  }

  const handleSelectRoom = (id: string) => {
    selectRoom(id)
    router.push('/')
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside
      className={cn(
        'flex flex-col h-full border-r border-border bg-card transition-all duration-200 flex-shrink-0',
        collapsed ? 'w-14' : 'w-[280px]'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border min-h-[56px]">
        {!collapsed && (
          <span className="font-semibold text-sm truncate">Platon AI</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors ml-auto flex-shrink-0"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {/* New Chat */}
      <div className="p-2">
        <Button
          onClick={handleCreateRoom}
          size="sm"
          className={cn('w-full', collapsed && 'px-0')}
        >
          {collapsed ? '+' : '+ New Chat'}
        </Button>
      </div>

      {/* Room List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : rooms.length === 0 && !collapsed ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            まだチャットがありません
          </p>
        ) : (
          rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => handleSelectRoom(room.id)}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                activeRoomId === room.id
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground'
              )}
              title={room.title}
            >
              {collapsed ? '💬' : <span className="block truncate">{room.title}</span>}
            </button>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border p-2 space-y-1">
        <button
          onClick={() => router.push('/settings')}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          {collapsed ? '⚙' : '⚙ Settings'}
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          {collapsed ? '↩' : '↩ Logout'}
        </button>
      </div>
    </aside>
  )
}
