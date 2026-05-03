import { create } from 'zustand'

interface SettingsState {
  theme: 'light' | 'dark' | 'system'
  defaultChatModel: string
  defaultImageModel: string
  loadSettings: () => Promise<void>
  updateSettings: (settings: Record<string, unknown>) => Promise<void>
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  theme: 'system',
  defaultChatModel: 'gpt-4',
  defaultImageModel: 'dall-e-3',

  loadSettings: async () => {
    try {
      const result = await window.electronAPI.settings.get()
      if (result.success && result.data) {
        set(result.data)
      }
    } catch (error) {
      console.error('加载设置失败:', error)
    }
  },

  updateSettings: async (settings) => {
    try {
      await window.electronAPI.settings.update(settings)
      set(settings as Partial<SettingsState>)
    } catch (error) {
      console.error('更新设置失败:', error)
    }
  },

  setTheme: (theme) => set({ theme })
}))
