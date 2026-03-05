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
    set({ isGenerating: true, generationStep: '準備中...' })

    // Helper: fetch with auto-retry on 504/empty response (handles Lambda cold start)
    const fetchWithRetry = async (url: string, body: object, maxRetries = 2): Promise<any> => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        let data: any
        try {
          data = await res.json()
        } catch {
          // Empty response (likely 504 timeout from cold start)
          if (attempt < maxRetries) {
            // Wait briefly and retry — Lambda is now warm
            await new Promise(r => setTimeout(r, 1000))
            continue
          }
          throw new Error(`サーバーエラー (${res.status}): 応答タイムアウト。再度お試しください。`)
        }

        if (!res.ok) {
          if (res.status >= 500 && attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 1000))
            continue
          }
          throw new Error(data.error || `エラー (${res.status})`)
        }

        return data
      }
    }

    try {
      // Step 1: Generate profile + distribution
      set({ generationStep: 'プロファイル分析中...' })
      const step1Data = await fetchWithRetry(
        `/api/projects/${projectId}/prompt-set/generate`,
        { step: 'profile', answers }
      )

      // Step 2: Generate prompt set
      set({ generationStep: 'プロンプト生成中...' })
      const step2Data = await fetchWithRetry(
        `/api/projects/${projectId}/prompt-set/generate`,
        {
          step: 'prompts',
          profile: step1Data.profile,
          distribution: step1Data.distribution,
          answers,
        }
      )

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
