import OpenAI from 'openai'
import type { MessageImage } from '../../../shared/types'
import { logger } from '../utils/logger'

interface OptimizePromptRequest {
  userMessage: string
  action: 'generate' | 'edit' | 'reference'
  baseUrl: string
  apiKey: string
  model?: string
  selectedImageHints?: string[]
  selectedImages?: MessageImage[]
}

export interface PromptCandidate {
  prompt: string
  why: string
}

export interface OptimizePromptResult {
  optimizedPrompt: string
  candidates: PromptCandidate[]
  recommendedIndex: number
}

const GENERATE_SYSTEM_PROMPT = `你是一个图片生成 prompt 优化器。将用户的简短描述优化为高质量的生图 prompt。

规则：
1. 保留用户的核心意图
2. 根据意图自动补充画质、光照、构图、风格等描述
3. 不要编造用户没有要求的内容
4. 输出简洁，适合直接用于图片生成
5. 语言与用户输入一致

示例：
输入：画一只猫 → 一只可爱的猫咪，毛发蓬松，眼神灵动，自然光照，高清细节，温馨氛围
输入：赛博朋克城市 → 赛博朋克风格的城市夜景，霓虹灯闪烁，科幻氛围，8K高清，电影级构图
输入：风景照 → 壮丽的自然风景，蓝天白云，高清细节，专业摄影，自然光照`

const REFERENCE_SYSTEM_PROMPT = `你是一个图片生成 prompt 优化器。用户上传了一张参考图片，想基于这张图生成新图。

核心原则：
1. 不要描述参考图片的内容（图片已经传给模型了，模型会自己看）
2. 只关注用户想做什么（广告？海报？展示？）
3. 描述生成图片的风格、场景、构图、画质
4. 如果用户说"做一个广告"，就描述广告的风格
5. 如果用户说"换个背景"，就描述新背景
6. 如果用户说"为这个产品做广告"，就说"产品广告，高端商业摄影风格"

示例：
输入：做一个广告 → 高端商业广告摄影，产品居中展示，柔和自然光，简洁背景，8K超高清，专业产品摄影
输入：为这个产品做个海报 → 精美产品海报设计，视觉焦点集中，高级感，商业设计风格，高清细节
输入：换个背景 → 简洁干净的背景，柔和渐变，突出主体，专业摄影
输入：用这个风格画猫 → 可爱的猫咪，类似的艺术风格，高清细节，自然光照
输入：生成一个展示他的背景 → 产品展示场景，专业展台，柔和灯光，高端展示效果`

const EDIT_SYSTEM_PROMPT = `你是一个高级图片编辑 prompt 策略师。用户要对已有图片进行编辑。

规则：
1. 描述要做的修改，不要描述原图
2. 保持简洁明确
3. 语言与用户输入一致
4. 如果提供了已选图片上下文/视觉要点，必须结合这些信息，使指令更可执行
5. 输出多个风格不同但都可执行的编辑方案，并给出推荐项

示例：
输入：换个蓝色背景 → 将背景替换为纯蓝色，保持主体不变
输入：加个文字"Hello" → 在图片上方添加白色粗体文字"Hello"
输入：调亮一点 → 增加整体亮度和对比度`

const MULTI_CANDIDATE_OUTPUT_FORMAT = `请严格输出 JSON，格式如下：
{
  "recommendedIndex": 0,
  "candidates": [
    { "prompt": "候选1", "why": "为什么这样写" },
    { "prompt": "候选2", "why": "为什么这样写" },
    { "prompt": "候选3", "why": "为什么这样写" }
  ]
}
要求：
- candidates 固定输出 3 条
- prompt 必须可直接用于图片生成/编辑模型
- why 简短，20 字以内
- 不要输出任何 JSON 之外的内容`

const ADVANCED_EDIT_STRATEGY = `编辑候选生成要求（比常规更深入）：
1. 候选1：保真编辑。优先保持原主体身份、构图和光线，只改用户要求。
2. 候选2：商业强化。强调可用于广告/海报的视觉冲击、材质细节、对比层次。
3. 候选3：叙事升级。在不违背用户意图下，补充更具体的环境、镜头、情绪和动作细节。
4. 每条 prompt 都要明确：主体变化点、背景处理、光线风格、画质/质感目标、约束（如“保持其余元素不变”）。
5. 不要输出抽象套话；避免“优化一下”“更好看”等空泛表达。`

function safeParseCandidates(raw: string): OptimizePromptResult | null {
  try {
    const parsed = JSON.parse(raw)
    const candidates = Array.isArray(parsed?.candidates)
      ? parsed.candidates
        .map((item: any) => ({
          prompt: String(item?.prompt || '').trim(),
          why: String(item?.why || '').trim()
        }))
        .filter((item: PromptCandidate) => item.prompt.length > 0)
      : []
    if (candidates.length === 0) return null
    const recommendedIndex = Number.isInteger(parsed?.recommendedIndex)
      ? Math.max(0, Math.min(parsed.recommendedIndex, candidates.length - 1))
      : 0
    return {
      optimizedPrompt: candidates[recommendedIndex]?.prompt || candidates[0].prompt,
      candidates,
      recommendedIndex
    }
  } catch {
    return null
  }
}

function parseCandidatesWithRecovery(raw: string): OptimizePromptResult | null {
  const parsed = safeParseCandidates(raw)
  if (parsed) return parsed

  const jsonBlockMatch = raw.match(/\{[\s\S]*\}/)
  if (jsonBlockMatch) {
    return safeParseCandidates(jsonBlockMatch[0])
  }

  return null
}

async function recoverCandidatesByReformat(
  client: OpenAI,
  model: string,
  rawText: string
): Promise<OptimizePromptResult | null> {
  try {
    const res = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `你是 JSON 修复器。将输入内容整理为下述 JSON：
{
  "recommendedIndex": 0,
  "candidates": [
    { "prompt": "候选1", "why": "原因" },
    { "prompt": "候选2", "why": "原因" },
    { "prompt": "候选3", "why": "原因" }
  ]
}
必须输出 JSON，不要输出其它内容。`
        },
        {
          role: 'user',
          content: `请整理这段内容：\n${rawText}`
        }
      ]
    } as any)
    const fixedRaw = res.choices?.[0]?.message?.content?.trim() || ''
    logger.info(`[Prompt] 二次结构化输出: finish_reason=${res.choices?.[0]?.finish_reason}, usage=${JSON.stringify(res.usage)}, preview=${fixedRaw.slice(0, 220)}`)
    return parseCandidatesWithRecovery(fixedRaw)
  } catch (error) {
    logger.warn('[Prompt] 二次结构化失败', error as any)
    return null
  }
}

function buildFallbackResult(
  userMessage: string,
  action: OptimizePromptRequest['action'],
  hints: string[] = []
): OptimizePromptResult {
  const hintText = hints.slice(0, 3).join('；')
  if (action === 'edit') {
    return {
      optimizedPrompt: `${userMessage}。保持主体结构与其余场景不变，强化边缘细节与材质真实感，光线过渡自然。`,
      candidates: [
        {
          prompt: `${userMessage}。仅执行该修改，保持人物姿态、镜头视角与背景结构不变，修复边缘并保持自然光影。`,
          why: '保真编辑'
        },
        {
          prompt: `${userMessage}。提升商业视觉质感，强化主体细节与材质反射，优化前后景层次与对比，保持画面真实。`,
          why: '商业强化'
        },
        {
          prompt: `${userMessage}。在不改变主体构图前提下，增强叙事氛围与环境细节，统一色调与光线方向，输出高清细节。${hintText ? `参考要点：${hintText}。` : ''}`,
          why: '叙事升级'
        }
      ],
      recommendedIndex: 0
    }
  }

  return {
    optimizedPrompt: userMessage,
    candidates: [
      { prompt: userMessage, why: '保留原始意图' },
      { prompt: `${userMessage}，加强主体细节与构图，保持自然光影和高清质感`, why: '增强细节表现' },
      { prompt: `${userMessage}，突出主体，优化背景层次与色彩对比，保持真实风格`, why: '提升画面层次' }
    ],
    recommendedIndex: 0
  }
}

function isHttpUrl(url?: string): boolean {
  return !!url && /^https?:\/\//i.test(url)
}

function isMimoBaseUrl(baseUrl: string): boolean {
  return /xiaomimimo\.com/i.test(baseUrl)
}

function buildImageContentParts(images: MessageImage[]): Array<{ type: string; image_url?: { url: string }; text?: string }> {
  const parts: Array<{ type: string; image_url?: { url: string }; text?: string }> = []
  for (const img of images.slice(0, 3)) {
    if (isHttpUrl(img.url)) {
      parts.push({ type: 'image_url', image_url: { url: img.url! } })
      continue
    }
    if (img.data) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType || 'image/png'};base64,${img.data}` }
      })
    }
  }
  return parts
}

function logImageInputs(tag: string, images: MessageImage[]): void {
  const summary = images.slice(0, 3).map((img, idx) => ({
    idx,
    source: isHttpUrl(img.url) ? 'url' : (img.data ? 'base64' : 'empty'),
    mime: img.mimeType,
    url: img.url?.slice(0, 120) || ''
  }))
  logger.info(`[Prompt] ${tag}: ${JSON.stringify(summary)}`)
}

function getUserInputForTextOptimize(request: OptimizePromptRequest, allHints: string[]): string {
  if (request.action === 'edit' && allHints.length > 0) {
    return `用户编辑需求：${request.userMessage}

已选择待编辑图片的上下文要点：
${allHints.map((hint, idx) => `${idx + 1}. ${hint}`).join('\n')}

${ADVANCED_EDIT_STRATEGY}
${MULTI_CANDIDATE_OUTPUT_FORMAT}`
  }
  return `${request.userMessage}

${MULTI_CANDIDATE_OUTPUT_FORMAT}`
}

export async function optimizePrompt(request: OptimizePromptRequest): Promise<OptimizePromptResult> {
  try {
    const client = new OpenAI({ baseURL: request.baseUrl, apiKey: request.apiKey, timeout: 30000 })
    const useMimoParams = isMimoBaseUrl(request.baseUrl)

    const systemPrompt = request.action === 'reference' ? REFERENCE_SYSTEM_PROMPT
      : request.action === 'edit' ? EDIT_SYSTEM_PROMPT
      : GENERATE_SYSTEM_PROMPT

    const textHints = (request.selectedImageHints || [])
      .map((hint) => hint?.trim())
      .filter(Boolean)
      .slice(0, 5)

    const imageParts = request.action === 'edit' && request.selectedImages?.length
      ? buildImageContentParts(request.selectedImages)
      : []
    logImageInputs('优化输入图片', request.selectedImages || [])

    const allHints = [...textHints].filter(Boolean).slice(0, 8)
    logger.info(`[Prompt] 优化请求: action=${request.action}, textHints=${textHints.length}, imageParts=${imageParts.length}, input="${request.userMessage}"`)

    const multimodalUserContent = imageParts.length > 0
      ? [
        ...imageParts,
        {
          type: 'text',
          text: `用户编辑需求：${request.userMessage}

${allHints.length > 0 ? `用户补充上下文：\n${allHints.map((hint, idx) => `${idx + 1}. ${hint}`).join('\n')}\n\n` : ''}${ADVANCED_EDIT_STRATEGY}
${MULTI_CANDIDATE_OUTPUT_FORMAT}`
        }
      ]
      : undefined

    const reqBody: any = {
      model: request.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: request.action === 'edit' ? `${systemPrompt}\n\n${ADVANCED_EDIT_STRATEGY}` : systemPrompt },
        {
          role: 'user',
          content: multimodalUserContent || getUserInputForTextOptimize(request, allHints)
        }
      ],
      temperature: request.action === 'edit' ? 0.7 : 0.9,
      response_format: { type: 'json_object' }
    }

    logger.info(`[Prompt] 请求参数: ${JSON.stringify({
      model: reqBody.model,
      action: request.action,
      mimo: useMimoParams,
      hasImageParts: imageParts.length > 0,
      response_format: reqBody.response_format?.type
    })}`)

    const response = await client.chat.completions.create(reqBody)

    const raw = response.choices[0]?.message?.content?.trim() || ''
    logger.info(`[Prompt] 响应状态: finish_reason=${response.choices?.[0]?.finish_reason}, usage=${JSON.stringify(response.usage)}`)
    logger.info(`[Prompt] 响应原文预览: ${raw.slice(0, 500)}`)
    const parsed = parseCandidatesWithRecovery(raw)
    if (parsed) {
      logger.info(`[Prompt] 优化结果: candidates=${parsed.candidates.length}, recommended=${parsed.recommendedIndex}`)
      return parsed
    }

    if (raw) {
      const recovered = await recoverCandidatesByReformat(client, reqBody.model, raw)
      if (recovered) {
        logger.info(`[Prompt] 二次结构化成功: candidates=${recovered.candidates.length}, recommended=${recovered.recommendedIndex}`)
        return recovered
      }
    }

    // 模型偶尔不按 JSON 输出，进行兜底
    if (raw) {
      const fallback = buildFallbackResult(raw, request.action, allHints)
      fallback.optimizedPrompt = raw
      fallback.candidates[0] = { prompt: raw, why: '模型首选结果' }
      logger.info('[Prompt] 非 JSON 输出，已回退候选结果')
      return fallback
    }
  } catch (error) {
    logger.error(`[Prompt] 优化失败:`, error)
  }

  return buildFallbackResult(request.userMessage, request.action, request.selectedImageHints || [])
}
