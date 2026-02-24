import { create } from 'zustand'

interface Room {
  id: string
  title: string
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

interface RoomStore {
  rooms: Room[]
  activeRoomId: string | null
  isLoading: boolean
  fetchRooms: () => Promise<void>
  createRoom: (title?: string) => Promise<Room>
  selectRoom: (id: string) => void
  deleteRoom: (id: string) => Promise<void>
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  rooms: [],
  activeRoomId: null,
  isLoading: false,

  fetchRooms: async () => {
    set({ isLoading: true })
    const res = await fetch('/api/rooms')
    const rooms = await res.json()
    set({ rooms: Array.isArray(rooms) ? rooms : [], isLoading: false })
  },

  createRoom: async (title?: string) => {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title ?? '新しい会話' }),
    })
    const room = await res.json()
    set(s => ({ rooms: [room, ...s.rooms], activeRoomId: room.id }))
    return room
  },

  selectRoom: (id: string) => set({ activeRoomId: id }),

  deleteRoom: async (id: string) => {
    await fetch(`/api/rooms/${id}`, { method: 'DELETE' })
    set(s => ({
      rooms: s.rooms.filter(r => r.id !== id),
      activeRoomId: s.activeRoomId === id ? null : s.activeRoomId,
    }))
  },
}))
