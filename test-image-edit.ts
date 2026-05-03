/**
 * gpt-image-2 图片编辑测试
 *
 * 完全参照 OpenAI 官方文档 JavaScript 格式
 * 使用方法: npx tsx test-image-edit.ts [1|2|3]
 * 前提: 当前目录下有 test-output-generate.png
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

// ============ 测试 1: 普通编辑 ============
async function testEdit() {
  console.log('\n=== 测试 1: 普通编辑 (images.edit) ===\n')

  if (!fs.existsSync(INPUT_IMAGE)) {
    console.error(`输入图片不存在: ${INPUT_IMAGE}`)
    return
  }

  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY, timeout: 300000 })
  const prompt = '在这只猫的旁边加一只小狗，保持风格一致'

  // 官方格式: toFile + createReadStream
  const imageFile = await toFile(fs.createReadStream(INPUT_IMAGE), null, { type: 'image/png' })
  console.log(imageFile, JSON.stringify(imageFile, null, 2))
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

// ============ 测试 2: 流式编辑 ============
async function testEditStream() {
  console.log('\n=== 测试 2: 流式编辑 (images.edit + stream) ===\n')

  if (!fs.existsSync(INPUT_IMAGE)) {
    console.error(`输入图片不存在: ${INPUT_IMAGE}`)
    return
  }

  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY, timeout: 300000 })
  const prompt = '把背景换成蓝色天空'
  const imageFile = await toFile(fs.createReadStream(INPUT_IMAGE), null, { type: 'image/png' })

  console.log(`URL: POST ${BASE_URL}/images/edits`)
  console.log(`参数: model=gpt-image-2, image=[File], prompt="${prompt}", stream=true, partial_images=2`)
  console.log(`请求头: Authorization=Bearer ${API_KEY.slice(0, 8)}...\n`)

  try {
    // 官方格式: stream + partial_images
    const stream = await client.images.edit({
      model: 'gpt-image-2',
      image: [imageFile],
      prompt,
      stream: true,
      partial_images: 2,
    })

    let count = 0
    let finalB64 = ''

    for await (const event of stream) {
      count++
      console.log(`事件 #${count}: type=${event.type}`)

      if (event.type === 'image_generation.partial_image') {
        const idx = (event as any).partial_image_index
        const imageBase64 = (event as any).b64_json
        console.log(`  partial_image_index: ${idx}`)
        console.log(`  b64_json 长度: ${imageBase64?.length || 0}`)
        if (imageBase64) {
          const outPath = path.join(__dirname, `test-output-edit-partial-${idx}.png`)
          fs.writeFileSync(outPath, Buffer.from(imageBase64, 'base64'))
          console.log(`  已保存: ${outPath}`)
          finalB64 = imageBase64
        }
      } else {
        console.log(`  字段: ${JSON.stringify(Object.keys(event))}`)
        for (const [k, v] of Object.entries(event)) {
          if (k !== 'type') console.log(`  ${k}: ${typeof v === 'string' && v.length > 100 ? v.slice(0, 100) + '...' : v}`)
        }
      }
    }

    console.log(`\n共收到 ${count} 个事件`)
    if (finalB64) {
      const outPath = path.join(__dirname, 'test-output-edit-stream.png')
      fs.writeFileSync(outPath, Buffer.from(finalB64, 'base64'))
      console.log(`最终图片已保存: ${outPath}`)
    }
  } catch (error: any) {
    console.log(`错误: ${error.status} - ${error.message}`)
    if (error.error) console.log(`API 响应: ${JSON.stringify(error.error, null, 2)}`)
  }
}

// ============ 测试 3: 流式生成 ============
async function testGenerateStream() {
  console.log('\n=== 测试 3: 流式生成 (images.generate + stream) ===\n')

  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY, timeout: 300000 })
  const prompt = '一只可爱的橘猫坐在窗台上晒太阳，温馨氛围，高清细节'

  console.log(`URL: POST ${BASE_URL}/images/generations`)
  console.log(`参数: model=gpt-image-2, prompt="${prompt}", stream=true, partial_images=2`)
  console.log(`请求头: Authorization=Bearer ${API_KEY.slice(0, 8)}...\n`)

  try {
    // 官方格式: stream + partial_images
    const stream = await client.images.generate({
      prompt,
      model: 'gpt-image-2',
      stream: true,
      partial_images: 2,
    })

    let count = 0
    let finalB64 = ''

    for await (const event of stream) {
      count++
      console.log(`事件 #${count}: type=${event.type}`)

      if (event.type === 'image_generation.partial_image') {
        const idx = (event as any).partial_image_index
        const imageBase64 = (event as any).b64_json
        console.log(`  partial_image_index: ${idx}`)
        console.log(`  b64_json 长度: ${imageBase64?.length || 0}`)
        if (imageBase64) {
          const outPath = path.join(__dirname, `test-output-generate-partial-${idx}.png`)
          fs.writeFileSync(outPath, Buffer.from(imageBase64, 'base64'))
          console.log(`  已保存: ${outPath}`)
          finalB64 = imageBase64
        }
      } else {
        console.log(`  字段: ${JSON.stringify(Object.keys(event))}`)
        for (const [k, v] of Object.entries(event)) {
          if (k !== 'type') console.log(`  ${k}: ${typeof v === 'string' && v.length > 100 ? v.slice(0, 100) + '...' : v}`)
        }
      }
    }

    console.log(`\n共收到 ${count} 个事件`)
    if (finalB64) {
      const outPath = path.join(__dirname, 'test-output-generate-stream.png')
      fs.writeFileSync(outPath, Buffer.from(finalB64, 'base64'))
      console.log(`最终图片已保存: ${outPath}`)
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

  if (test === '1' || test === 'edit' || test === 'all') await testEdit()
  if (test === '2' || test === 'edit-stream' || test === 'all') await testEditStream()
  if (test === '3' || test === 'generate-stream' || test === 'all') await testGenerateStream()

  console.log('\n=== 测试完成 ===')
}

main()
