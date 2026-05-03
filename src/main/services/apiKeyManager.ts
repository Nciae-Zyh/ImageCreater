import { safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import type { ApiKeyRecord, ApiKeyDisplay, MessageImage } from '../../../shared/types'
import { addApiKey, getApiKey, getAllApiKeys, removeApiKey } from '../store/appStore'

export async function saveApiKey(
  name: string,
  baseUrl: string,
  apiKey: string,
  models: string[],
  chatModel: string = '',
  imageModel: string = '',
  visionModel: string = ''
): Promise<string> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('当前系统不支持安全存储，无法保存 API Key')
  }
  const encrypted = safeStorage.encryptString(apiKey)
  const record: ApiKeyRecord = {
    id: randomUUID(),
    name,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    encryptedKey: encrypted.toString('base64'),
    models,
    chatModel,
    imageModel,
    visionModel,
    createdAt: Date.now()
  }
  await addApiKey(record)
  return record.id
}

export async function getDecryptedKey(
  id: string
): Promise<{ baseUrl: string; apiKey: string; record: ApiKeyRecord }> {
  const record = await getApiKey(id)
  if (!record) throw new Error(`API Key [${id}] 不存在`)
  const buffer = Buffer.from(record.encryptedKey, 'base64')
  const apiKey = safeStorage.decryptString(buffer)
  return { baseUrl: record.baseUrl, apiKey, record }
}

export async function getAllApiKeysDisplay(): Promise<ApiKeyDisplay[]> {
  const keys = await getAllApiKeys()
  return keys.map((record) => ({
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    maskedKey: record.encryptedKey.slice(0, 8) + '***',
    models: record.models,
    chatModel: record.chatModel || record.models[0] || '',
    imageModel: record.imageModel || '',
    visionModel: record.visionModel || '',
    createdAt: record.createdAt
  }))
}

export async function deleteApiKey(id: string): Promise<void> {
  await removeApiKey(id)
}

export function buildVisionMessage(
  content: string,
  imageData?: MessageImage[]
): any {
  if (!imageData || imageData.length === 0) {
    return { role: 'user', content }
  }
  const contentParts: any[] = [{ type: 'text', text: content }]
  for (const img of imageData) {
    contentParts.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType};base64,${img.data}`
      }
    })
  }
  return { role: 'user', content: contentParts }
}
