import { create } from 'zustand'
import type { ApiKeyDisplay } from '@shared/types'

interface ProviderState {
  providers: ApiKeyDisplay[]
  activeProviderId: string | null
  selectedChatModel: string
  imageProviderId: string | null
  selectedImageModel: string
  loaded: boolean

  loadProviders: () => Promise<void>
  loadPreferences: () => Promise<void>
  setActiveProvider: (id: string) => void
  setImageProvider: (id: string) => void
  setSelectedChatModel: (model: string) => void
  setSelectedImageModel: (model: string) => void
  addProvider: (data: {
    name: string; baseUrl: string; apiKey: string; models: string[];
    chatModel: string; imageModel: string; visionModel: string
  }) => Promise<boolean>
  removeProvider: (id: string) => Promise<boolean>
}

async function savePref(key: string, value: string) {
  try { await window.electronAPI.prefs.save(key, value) } catch {}
}

export const useProviderStore = create<ProviderState>()((set, get) => ({
  providers: [],
  activeProviderId: null,
  selectedChatModel: 'gpt-4o',
  imageProviderId: null,
  selectedImageModel: 'dall-e-3',
  loaded: false,

  loadProviders: async () => {
    try {
      if (!window.electronAPI?.apiKeys) {
        console.warn('electronAPI 未就绪，跳过加载 providers')
        set({ loaded: true })
        return
      }
      const result = await window.electronAPI.apiKeys.getAll()
      if (result.success) {
        const providers = result.data as ApiKeyDisplay[]
        set({ providers })
        if (!get().loaded) {
          await get().loadPreferences()
        }
      }
    } catch (error) {
      console.error('加载 providers 失败:', error)
    }
  },

  loadPreferences: async () => {
    try {
      if (!window.electronAPI?.prefs) {
        set({ loaded: true })
        return
      }
      const result = await window.electronAPI.prefs.getAll()
      if (result.success && result.data) {
        const prefs = result.data as Record<string, string>
        set({
          activeProviderId: prefs['activeProviderId'] || null,
          selectedChatModel: prefs['selectedChatModel'] || 'gpt-4o',
          imageProviderId: prefs['imageProviderId'] || null,
          selectedImageModel: prefs['selectedImageModel'] || 'dall-e-3',
          loaded: true
        })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  setActiveProvider: (id) => {
    const provider = get().providers.find((p) => p.id === id)
    set({ activeProviderId: id, selectedChatModel: provider?.chatModel || 'gpt-4o' })
    savePref('activeProviderId', id)
    savePref('selectedChatModel', provider?.chatModel || 'gpt-4o')
  },

  setImageProvider: (id) => {
    const provider = get().providers.find((p) => p.id === id)
    set({ imageProviderId: id, selectedImageModel: provider?.imageModel || '' })
    savePref('imageProviderId', id)
    savePref('selectedImageModel', provider?.imageModel || '')
  },

  setSelectedChatModel: (model) => {
    set({ selectedChatModel: model })
    savePref('selectedChatModel', model)
  },

  setSelectedImageModel: (model) => {
    set({ selectedImageModel: model })
    savePref('selectedImageModel', model)
  },

  addProvider: async (data) => {
    try {
      if (!window.electronAPI?.apiKeys) return false
      const result = await window.electronAPI.apiKeys.save(data)
      if (result.success) {
        await get().loadProviders()
        return true
      }
      return false
    } catch (error) {
      console.error('添加 provider 失败:', error)
      return false
    }
  },

  removeProvider: async (id) => {
    try {
      if (!window.electronAPI?.apiKeys) return false
      const result = await window.electronAPI.apiKeys.delete(id)
      if (result.success) {
        await get().loadProviders()
        return true
      }
      return false
    } catch (error) {
      console.error('删除 provider 失败:', error)
      return false
    }
  }
}))
