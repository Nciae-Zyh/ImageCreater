import type { ApiKeyRecord } from '../../../shared/types'
import type { AppSettings } from '../types/settings'
import { safeStorage } from 'electron'

export interface PersistedR2Config {
  accountId: string
  accessKeyId: string
  encryptedSecretAccessKey: string
  bucketName: string
  publicBaseUrl?: string
}

export interface R2PlainConfig {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  publicBaseUrl?: string
}

interface AppStoreSchema {
  apiKeys: ApiKeyRecord[]
  settings: AppSettings
  r2Config?: PersistedR2Config
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

export async function saveR2Config(config: R2PlainConfig): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不支持安全存储，无法保存 R2 Secret Access Key')
  }
  const store = await getStore()
  const encryptedSecret = safeStorage.encryptString(config.secretAccessKey)
  store.set('r2Config', {
    accountId: config.accountId.trim(),
    accessKeyId: config.accessKeyId.trim(),
    encryptedSecretAccessKey: encryptedSecret.toString('base64'),
    bucketName: config.bucketName.trim(),
    publicBaseUrl: config.publicBaseUrl?.trim() || undefined
  })
}

export async function loadR2Config(): Promise<R2PlainConfig | null> {
  const store = await getStore()
  const config = store.get('r2Config')
  if (!config?.encryptedSecretAccessKey) return null
  const buffer = Buffer.from(config.encryptedSecretAccessKey, 'base64')
  return {
    accountId: config.accountId,
    accessKeyId: config.accessKeyId,
    secretAccessKey: safeStorage.decryptString(buffer),
    bucketName: config.bucketName,
    publicBaseUrl: config.publicBaseUrl
  }
}
