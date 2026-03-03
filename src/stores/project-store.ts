import { create } from 'zustand'

interface Project {
  id: string
  name: string
  status: 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

interface ProjectStore {
  projects: Project[]
  activeProjectId: string | null
  isLoading: boolean
  fetchProjects: () => Promise<void>
  createProject: (name: string) => Promise<Project>
  selectProject: (id: string) => void
  deleteProject: (id: string) => Promise<void>
  updateProject: (id: string, data: Partial<Pick<Project, 'name' | 'isArchived'>>) => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProjectId: null,
  isLoading: false,

  fetchProjects: async () => {
    set({ isLoading: true })
    const res = await fetch('/api/projects')
    const projects = await res.json()
    set({ projects: Array.isArray(projects) ? projects : [], isLoading: false })
  },

  createProject: async (name: string) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const project = await res.json()
    set(s => ({ projects: [project, ...s.projects], activeProjectId: project.id }))
    return project
  },

  selectProject: (id: string) => set({ activeProjectId: id }),

  deleteProject: async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    set(s => ({
      projects: s.projects.filter(p => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
    }))
  },

  updateProject: async (id: string, data: Partial<Pick<Project, 'name' | 'isArchived'>>) => {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const updated = await res.json()
    set(s => ({
      projects: s.projects.map(p => (p.id === id ? { ...p, ...updated } : p)),
    }))
  },
}))
