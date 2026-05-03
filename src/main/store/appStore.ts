import type { ApiKeyRecord } from '../../../shared/types'
import type { AppSettings } from '../types/settings'

interface AppStoreSchema {
  apiKeys: ApiKeyRecord[]
  settings: AppSettings
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultProviderId: null,
  defaultChatModel: 'gpt-4',
  defaultImageModel: 'dall-e-3',
  theme: 'system'
}

let _store: any = null

async function getStore(): Promise<any> {
  if (_store) return _store
  const { default: Store } = await import('electron-store')
  _store = new Store<AppStoreSchema>({
    name: 'app-data',
    defaults: {
      apiKeys: [],
      settings: DEFAULT_SETTINGS
    }
  })
  return _store
}

export async function getAllApiKeys(): Promise<ApiKeyRecord[]> {
  const store = await getStore()
  return store.get('apiKeys')
}

export async function getApiKey(id: string): Promise<ApiKeyRecord | undefined> {
  const store = await getStore()
  return store.get('apiKeys').find((k: ApiKeyRecord) => k.id === id)
}

export async function addApiKey(record: ApiKeyRecord): Promise<void> {
  const store = await getStore()
  const keys = store.get('apiKeys')
  store.set('apiKeys', [...keys, record])
}

export async function removeApiKey(id: string): Promise<void> {
  const store = await getStore()
  const keys = store.get('apiKeys')
  store.set(
    'apiKeys',
    keys.filter((k: ApiKeyRecord) => k.id !== id)
  )
}

export async function getSettings(): Promise<AppSettings> {
  const store = await getStore()
  return store.get('settings')
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<void> {
  const store = await getStore()
  const current = store.get('settings')
  store.set('settings', { ...current, ...settings })
}
