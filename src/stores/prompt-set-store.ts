import { create } from 'zustand'

interface PromptItem {
  id: string
  category: string
  prompt: string
  evaluationFocus: string
  goldStandardHint: string | null
  orderIndex: number
}

interface PromptSet {
  id: string
  source: 'GENERATED' | 'IMPORTED'
  generationConfig: any
  promptItems: PromptItem[]
}

interface PromptSetStore {
  promptSet: PromptSet | null
  isLoading: boolean
  isGenerating: boolean
  generationStep: string
  fetchPromptSet: (projectId: string) => Promise<void>
  generatePromptSet: (projectId: string, answers: Record<string, any>) => Promise<void>
  importPromptSet: (projectId: string, file: File) => Promise<void>
  editItem: (projectId: string, itemId: string, data: Partial<PromptItem>) => Promise<void>
  addItem: (projectId: string, data: Omit<PromptItem, 'id'>) => Promise<void>
  deleteItem: (projectId: string, itemId: string) => Promise<void>
}

export const usePromptSetStore = create<PromptSetStore>((set, get) => ({
  promptSet: null,
  isLoading: false,
  isGenerating: false,
  generationStep: '',

  fetchPromptSet: async (projectId: string) => {
    set({ isLoading: true })
    try {
      const res = await fetch(`/api/projects/${projectId}/prompt-set`)
      if (res.ok) {
        const data = await res.json()
        set({ promptSet: data, isLoading: false })
      } else {
        set({ promptSet: null, isLoading: false })
      }
    } catch {
      set({ promptSet: null, isLoading: false })
    }
  },

  generatePromptSet: async (projectId: string, answers: Record<string, any>) => {
    set({ isGenerating: true, generationStep: 'プロファイル分析中...' })
    try {
      // Step 1: Generate profile + distribution (~6s)
      const res1 = await fetch(`/api/projects/${projectId}/prompt-set/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'profile', answers }),
      })

      let step1Data: any
      try {
        step1Data = await res1.json()
      } catch {
        throw new Error(`サーバーエラー (${res1.status}): プロファイル生成の応答が空です。`)
      }
      if (!res1.ok) {
        throw new Error(step1Data.error || 'プロファイル生成に失敗しました')
      }

      // Step 2: Generate prompt set (~20-25s)
      set({ generationStep: 'プロンプト生成中...' })
      const res2 = await fetch(`/api/projects/${projectId}/prompt-set/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'prompts',
          profile: step1Data.profile,
          distribution: step1Data.distribution,
          answers,
        }),
      })

      let step2Data: any
      try {
        step2Data = await res2.json()
      } catch {
        throw new Error(`サーバーエラー (${res2.status}): プロンプト生成の応答が空です。Amplifyのタイムアウトを60秒以上に設定してください。`)
      }
      if (!res2.ok) {
        throw new Error(step2Data.error || 'プロンプト生成に失敗しました')
      }

      set({ promptSet: step2Data, isGenerating: false, generationStep: '' })
    } catch (e) {
      set({ isGenerating: false, generationStep: '' })
      throw e
    }
  },

  importPromptSet: async (projectId: string, file: File) => {
    set({ isLoading: true })
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/projects/${projectId}/prompt-set/import`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        set({ promptSet: data, isLoading: false })
      } else {
        set({ isLoading: false })
        throw new Error('インポートに失敗しました')
      }
    } catch (e) {
      set({ isLoading: false })
      throw e
    }
  },

  editItem: async (projectId: string, itemId: string, data: Partial<PromptItem>) => {
    const res = await fetch(`/api/projects/${projectId}/prompt-set/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      const updated = await res.json()
      set(s => {
        if (!s.promptSet) return s
        return {
          promptSet: {
            ...s.promptSet,
            promptItems: s.promptSet.promptItems.map(item =>
              item.id === itemId ? { ...item, ...updated } : item
            ),
          },
        }
      })
    }
  },

  addItem: async (projectId: string, data: Omit<PromptItem, 'id'>) => {
    const res = await fetch(`/api/projects/${projectId}/prompt-set/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      const newItem = await res.json()
      set(s => {
        if (!s.promptSet) return s
        return {
          promptSet: {
            ...s.promptSet,
            promptItems: [...s.promptSet.promptItems, newItem],
          },
        }
      })
    }
  },

  deleteItem: async (projectId: string, itemId: string) => {
    await fetch(`/api/projects/${projectId}/prompt-set/items/${itemId}`, { method: 'DELETE' })
    set(s => {
      if (!s.promptSet) return s
      return {
        promptSet: {
          ...s.promptSet,
          promptItems: s.promptSet.promptItems.filter(item => item.id !== itemId),
        },
      }
    })
  },
}))
