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
