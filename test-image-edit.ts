/**
 * gpt-image-2 图片生成/编辑测试
 *
 * 参照 OpenAI 官方文档 JavaScript 格式
 * 使用方法: npx tsx test-image-edit.ts [1|2]
 *
 * 测试内容:
 *   1. 图片生成 (images.generate)
 *   2. 图片编辑 (images.edit + toFile)
 *
 * 环境变量:
 *   OPENAI_API_KEY=sk-xxx
 *   OPENAI_BASE_URL=https://api.openai.com/v1 (可选)
 */

import OpenAI, { toFile } from 'openai'
import fs from 'fs'
import path from 'path'

const API_KEY = process.env.OPENAI_API_KEY || ''
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'

if (!API_KEY) {
  console.error('请设置环境变量 OPENAI_API_KEY')
  process.exit(1)
}

const INPUT_IMAGE = path.join(__dirname, 'test-output-generate.png')

// ============ 测试 1: 图片生成 ============
async function testGenerate() {
  console.log('\n=== 测试 1: 图片生成 (images.generate) ===\n')

  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY, timeout: 300000 })
  const prompt = '一只可爱的橘猫坐在窗台上晒太阳，温馨氛围，高清细节'

  console.log(`URL: POST ${BASE_URL}/images/generations`)
  console.log(`参数: model=gpt-image-2, prompt="${prompt}"`)
  console.log(`请求头: Authorization=Bearer ${API_KEY.slice(0, 8)}...\n`)

  try {
    const result = await client.images.generate({ model: 'gpt-image-2', prompt })

    const image_base64 = result.data[0].b64_json
    console.log('--- 响应 ---')
    console.log(`model: ${(result as any).model}`)
    console.log(`b64_json 长度: ${image_base64?.length || 0}`)

    if (image_base64) {
      const image_bytes = Buffer.from(image_base64, 'base64')
      const outPath = path.join(__dirname, 'test-output-generate.png')
      fs.writeFileSync(outPath, image_bytes)
      console.log(`已保存: ${outPath}`)
      console.log(`\n后续编辑测试将使用此图片作为输入`)
    }
  } catch (error: any) {
    console.log(`错误: ${error.status} - ${error.message}`)
    if (error.error) console.log(`API 响应: ${JSON.stringify(error.error, null, 2)}`)
  }
}

// ============ 测试 2: 图片编辑 ============
async function testEdit() {
  console.log('\n=== 测试 2: 图片编辑 (images.edit) ===\n')

  if (!fs.existsSync(INPUT_IMAGE)) {
    console.error(`输入图片不存在: ${INPUT_IMAGE}`)
    console.error('请先运行测试 1 生成图片，或手动放置 test-output-generate.png')
    return
  }

  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY, timeout: 300000 })
  const prompt = '在这只猫的旁边加一只小狗，保持风格一致'

  const imageFile = await toFile(fs.createReadStream(INPUT_IMAGE), null, { type: 'image/png' })

  console.log(`URL: POST ${BASE_URL}/images/edits`)
  console.log(`参数: model=gpt-image-2, image=[File], prompt="${prompt}"`)
  console.log(`请求头: Authorization=Bearer ${API_KEY.slice(0, 8)}...\n`)

  try {
    const response = await client.images.edit({
      model: 'gpt-image-2',
      image: [imageFile],
      prompt,
    })

    const image_base64 = response.data[0].b64_json
    console.log('--- 响应 ---')
    console.log(`model: ${(response as any).model}`)
    console.log(`b64_json 长度: ${image_base64?.length || 0}`)

    if (image_base64) {
      const image_bytes = Buffer.from(image_base64, 'base64')
      const outPath = path.join(__dirname, 'test-output-edit.png')
      fs.writeFileSync(outPath, image_bytes)
      console.log(`已保存: ${outPath}`)
    }
  } catch (error: any) {
    console.log(`错误: ${error.status} - ${error.message}`)
    if (error.error) console.log(`API 响应: ${JSON.stringify(error.error, null, 2)}`)
  }
}

// ============ 主函数 ============
async function main() {
  console.log('=== gpt-image-2 图片生成/编辑测试 ===')
  console.log(`API: ${BASE_URL}`)
  console.log(`Key: ${API_KEY.slice(0, 8)}...`)

  const test = process.argv[2] || 'all'

  if (test === '1' || test === 'generate' || test === 'all') await testGenerate()
  if (test === '2' || test === 'edit' || test === 'all') await testEdit()

  console.log('\n=== 测试完成 ===')
}

main()
