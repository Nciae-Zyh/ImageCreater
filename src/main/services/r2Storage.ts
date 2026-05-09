import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { logger } from '../utils/logger'

/**
 * Cloudflare R2 对象存储
 * 用于将图片上传为可访问的 URL
 *
 * 配置方式：
 * 1. 在前端设置页面配置 R2 信息
 * 2. 或通过环境变量配置
 */

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  publicBaseUrl?: string // 自定义域名，如 https://img.example.com
}

let r2Client: S3Client | null = null
let r2Config: R2Config | null = null

export function initR2(config: R2Config): void {
  r2Config = config
  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  })
  logger.info(`[R2] 初始化完成, bucket: ${config.bucketName}`)
}

export function isR2Configured(): boolean {
  return r2Client !== null && r2Config !== null
}

export async function uploadImageToR2(
  base64Data: string,
  filename: string,
  mimeType: string = 'image/png'
): Promise<string> {
  if (!r2Client || !r2Config) {
    throw new Error('R2 未配置，请在设置中配置 Cloudflare R2')
  }

  const buffer = Buffer.from(base64Data, 'base64')
  const key = `images/${filename}`

  const command = new PutObjectCommand({
    Bucket: r2Config.bucketName,
    Key: key,
    Body: buffer,
    ContentType: mimeType
  })

  await r2Client.send(command)

  // 构建公开访问 URL
  if (r2Config.publicBaseUrl) {
    return `${r2Config.publicBaseUrl}/${key}`
  }
  return `https://${r2Config.accountId}.r2.cloudflarestorage.com/${r2Config.bucketName}/${key}`
}

export function getR2Config(): R2Config | null {
  return r2Config
}

function maskValue(value?: string): string {
  if (!value) return ''
  if (value.length <= 10) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export function getR2ConfigSummary(): {
  configured: boolean
  accountId?: string
  accessKeyId?: string
  bucketName?: string
  apiEndpoint?: string
  publicBaseUrl?: string
  hasPublicBaseUrl?: boolean
} {
  if (!r2Config) return { configured: false }
  return {
    configured: true,
    accountId: r2Config.accountId,
    accessKeyId: maskValue(r2Config.accessKeyId),
    bucketName: r2Config.bucketName,
    apiEndpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
    publicBaseUrl: r2Config.publicBaseUrl,
    hasPublicBaseUrl: !!r2Config.publicBaseUrl
  }
}

export async function testR2Connection(): Promise<{ key: string; apiEndpoint: string; publicUrl: string | null }> {
  if (!r2Client || !r2Config) {
    throw new Error('R2 未配置，请先保存 R2 配置')
  }

  const key = `healthcheck/r2-test-${Date.now()}.txt`
  const apiEndpoint = `https://${r2Config.accountId}.r2.cloudflarestorage.com`
  logger.info(`[R2 Test] endpoint=${apiEndpoint}, bucket=${r2Config.bucketName}, key=${key}`)
  logger.info(`[R2 Test] accessKeyId=${process.env.ELECTRON_RENDERER_URL ? r2Config.accessKeyId : maskValue(r2Config.accessKeyId)}`)
  if (process.env.ELECTRON_RENDERER_URL) logger.info(`[R2 Test] secretAccessKey=${r2Config.secretAccessKey}`)

  const command = new PutObjectCommand({
    Bucket: r2Config.bucketName,
    Key: key,
    Body: Buffer.from(`ImageCreater R2 test ${new Date().toISOString()}`, 'utf-8'),
    ContentType: 'text/plain; charset=utf-8'
  })

  await r2Client.send(command)

  return {
    key,
    apiEndpoint,
    publicUrl: r2Config.publicBaseUrl ? `${r2Config.publicBaseUrl}/${key}` : null
  }
}
