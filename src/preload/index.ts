import { contextBridge, ipcRenderer } from 'electron'

try {
  const IPC_CHANNELS = {
    API_KEY: {
      GET_ALL: 'api-key:get-all',
      SAVE: 'api-key:save',
      DELETE: 'api-key:delete',
      VALIDATE: 'api-key:validate'
    },
    CHAT: {
      SEND: 'chat:send',
      STREAM: 'chat:stream',
      CANCEL: 'chat:cancel'
    },
    SETTINGS: {
      GET: 'settings:get',
      UPDATE: 'settings:update'
    },
    APP: {
      VERSION: 'app:version'
    }
  }

  const electronAPI = {
    invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
      ipcRenderer.invoke(channel, ...args),

    send: (channel: string, ...args: unknown[]): void =>
      ipcRenderer.send(channel, ...args),

    on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
        callback(...args)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },

    apiKeys: {
      getAll: () => ipcRenderer.invoke(IPC_CHANNELS.API_KEY.GET_ALL),
      save: (data: {
        name: string; baseUrl: string; apiKey: string; models: string[];
        chatModel: string; imageModel: string; visionModel: string
      }) => ipcRenderer.invoke(IPC_CHANNELS.API_KEY.SAVE, data),
      delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.API_KEY.DELETE, id),
      validate: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.API_KEY.VALIDATE, id)
    },

    chat: {
      send: (data: {
        message: string; conversationId: string; providerId: string;
        imageProviderId?: string;
        imageData?: Array<{ type: 'image'; mimeType: string; data: string }>;
        modelSelection?: { mode: 'auto' | 'manual'; chatModel?: string; visionModel?: string; imageModel?: string }
      }) => ipcRenderer.invoke(IPC_CHANNELS.CHAT.SEND, data),
      onStream: (callback: (chunk: string) => void) => {
        const handler = (_e: Electron.IpcRendererEvent, chunk: string) => callback(chunk)
        ipcRenderer.on(IPC_CHANNELS.CHAT.STREAM, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT.STREAM, handler)
      },
      cancel: (conversationId: string) =>
        ipcRenderer.send(IPC_CHANNELS.CHAT.CANCEL, conversationId),
      analyzeIntent: (data: { message: string; providerId: string; hasImage: boolean }) =>
        ipcRenderer.invoke(IPC_CHANNELS.CHAT.ANALYZE_INTENT, data)
    },

    conversations: {
      getAll: () => ipcRenderer.invoke('conversation:get-all'),
      getMessages: (id: string) => ipcRenderer.invoke('conversation:get-messages', id),
      getImages: (id: string) => ipcRenderer.invoke('conversation:get-images', id),
      delete: (id: string) => ipcRenderer.invoke('conversation:delete', id)
    },

    settings: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.GET),
      update: (settings: Record<string, unknown>) =>
        ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.UPDATE, settings)
    },

    image: {
      saveAs: (imageUrl: string) => ipcRenderer.invoke('image:save-as', imageUrl)
    },

    prefs: {
      getAll: () => ipcRenderer.invoke('prefs:get-all'),
      save: (key: string, value: string) => ipcRenderer.invoke('prefs:save', key, value)
    },

    r2: {
      configure: (config: any) => ipcRenderer.invoke('r2:configure', config),
      status: () => ipcRenderer.invoke('r2:status')
    },

    app: {
      platform: () => {
        const p = navigator.platform.toLowerCase()
        if (p.includes('mac')) return 'darwin'
        if (p.includes('win')) return 'win32'
        return 'linux'
      },
      version: () => ipcRenderer.invoke(IPC_CHANNELS.APP.VERSION)
    }
  }

  contextBridge.exposeInMainWorld('electronAPI', electronAPI)
} catch (err) {
  console.error('Preload script error:', err)
}
