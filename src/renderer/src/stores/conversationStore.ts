import { create } from 'zustand'
import type { Conversation, Message } from '@shared/types'

interface ConversationState {
  conversations: Conversation[]
  activeConversationId: string | null
  loadConversations: () => Promise<void>
  loadMessages: (conversationId: string) => Promise<void>
  createConversation: (providerId: string, model: string) => string
  switchConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  addMessage: (conversationId: string, message: Message) => void
  removeMessage: (conversationId: string, messageId: string) => void
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void
  updateLastAssistantMessage: (conversationId: string, content: string) => void
  getActiveConversation: () => Conversation | undefined
}

export const useConversationStore = create<ConversationState>()((set, get) => ({
  conversations: [],
  activeConversationId: null,

  loadConversations: async () => {
    try {
      if (!window.electronAPI?.conversations) return
      const result = await window.electronAPI.conversations.getAll()
      if (result.success) {
        const conversations = (result.data as any[]).map((c) => ({
          id: c.id,
          title: c.title,
          providerId: c.provider_id,
          model: c.model,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          messages: [],
          messageCount: c.message_count || 0
        }))
        set({ conversations })
      }
    } catch (error) {
      console.error('加载对话列表失败:', error)
    }
  },

  loadMessages: async (conversationId: string) => {
    try {
      if (!window.electronAPI?.conversations) return
      const result = await window.electronAPI.conversations.getMessages(conversationId)
      if (result.success) {
        const messages = (result.data as any[]).map((m) => {
          // 从 metadata 中提取 steps 和 needUserSelect
          let meta: any = {}
          try { meta = m.metadata ? JSON.parse(m.metadata) : {} } catch { meta = {} }
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            type: m.type,
            imageUrl: m.image_url || undefined,
            imageData: m.image_data ? JSON.parse(m.image_data) : undefined,
            metadata: m.metadata || undefined,
            steps: meta.steps || [],
            needUserSelect: meta.needUserSelect || false,
            timestamp: m.timestamp
          }
        })
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, messages } : c
          )
        }))
      }
    } catch (error) {
      console.error('加载消息失败:', error)
    }
  },

  createConversation: (providerId, model) => {
    const id = crypto.randomUUID()
    const conversation: Conversation = {
      id,
      title: '新对话',
      providerId,
      model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    }
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: id
    }))
    return id
  },

  switchConversation: async (id) => {
    set({ activeConversationId: id })
    const target = get().conversations.find((c) => c.id === id)
    // 若本地已有消息（可能包含实时流式状态），避免切换时被 DB 快照覆盖。
    if (!target || target.messages.length === 0) {
      await get().loadMessages(id)
    }
  },

  deleteConversation: async (id) => {
    try {
      if (window.electronAPI?.conversations) {
        await window.electronAPI.conversations.delete(id)
      }
      set((state) => ({
        conversations: state.conversations.filter((c) => c.id !== id),
        activeConversationId:
          state.activeConversationId === id
            ? state.conversations[0]?.id ?? null
            : state.activeConversationId
      }))
    } catch (error) {
      console.error('删除对话失败:', error)
    }
  },

  addMessage: (conversationId, message) =>
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (c.id !== conversationId) return c
        const updatedMessages = [...c.messages, message]
        return {
          ...c,
          messages: updatedMessages,
          title:
            c.messages.length === 0 && message.role === 'user'
              ? message.content.slice(0, 20) + (message.content.length > 20 ? '...' : '')
              : c.title,
          updatedAt: Date.now()
        }
      })
    })),

  removeMessage: (conversationId, messageId) =>
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (c.id !== conversationId) return c
        return { ...c, messages: c.messages.filter((m) => m.id !== messageId), updatedAt: Date.now() }
      })
    })),

  updateMessage: (conversationId, messageId, updates) =>
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (c.id !== conversationId) return c
        const messages = c.messages.map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        )
        return { ...c, messages, updatedAt: Date.now() }
      })
    })),

  updateLastAssistantMessage: (conversationId, content) =>
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (c.id !== conversationId) return c
        const messages = [...c.messages]
        const lastIdx = messages.length - 1
        if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
          messages[lastIdx] = { ...messages[lastIdx], content }
        }
        return { ...c, messages, updatedAt: Date.now() }
      })
    })),

  getActiveConversation: () => {
    const state = get()
    return state.conversations.find((c) => c.id === state.activeConversationId)
  }
}))
