import OpenAI from 'openai'
import { matchProvider } from './providers/registry'
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

function buildFallbackResult(userMessage: string): OptimizePromptResult {
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

async function buildVisionHints(
  request: OptimizePromptRequest
): Promise<string[]> {
  if (!request.selectedImages || request.selectedImages.length === 0) return []
  try {
    const provider = matchProvider(request.baseUrl)
    const model = request.model || 'gpt-4o-mini'
    const vision = await provider.vision({
      prompt: '请用中文简要描述这些图片中与后续编辑最相关的主体、场景、材质、光线、风格要点，输出 3-5 条短句。',
      images: request.selectedImages.slice(0, 3),
      model,
      baseUrl: request.baseUrl,
      apiKey: request.apiKey
    })
    const lines = String(vision.content || '')
      .split('\n')
      .map((line) => line.replace(/^[-*\d\.\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 6)
    logger.info(`[Prompt] 视觉要点提取完成: ${lines.length} 条`)
    return lines
  } catch (error) {
    logger.warn('[Prompt] 视觉要点提取失败，回退为文本上下文', error as any)
    return []
  }
}

export async function optimizePrompt(request: OptimizePromptRequest): Promise<OptimizePromptResult> {
  try {
    const client = new OpenAI({ baseURL: request.baseUrl, apiKey: request.apiKey, timeout: 30000 })

    const systemPrompt = request.action === 'reference' ? REFERENCE_SYSTEM_PROMPT
      : request.action === 'edit' ? EDIT_SYSTEM_PROMPT
      : GENERATE_SYSTEM_PROMPT

    const textHints = (request.selectedImageHints || [])
      .map((hint) => hint?.trim())
      .filter(Boolean)
      .slice(0, 5)

    const visionHints = request.action === 'edit' && request.selectedImages && request.selectedImages.length > 0
      ? await buildVisionHints(request)
      : []
    const allHints = [...textHints, ...visionHints].filter(Boolean).slice(0, 8)

    const userInput = request.action === 'edit' && allHints.length > 0
      ? `用户编辑需求：${request.userMessage}

已选择待编辑图片的上下文要点：
${allHints.map((hint, idx) => `${idx + 1}. ${hint}`).join('\n')}

${MULTI_CANDIDATE_OUTPUT_FORMAT}`
      : `${request.userMessage}

${MULTI_CANDIDATE_OUTPUT_FORMAT}`
    logger.info(`[Prompt] 优化请求: action=${request.action}, textHints=${textHints.length}, visionHints=${visionHints.length}, input="${request.userMessage}"`)

    const response = await client.chat.completions.create({
      model: request.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput }
      ],
      temperature: 0.95,
      max_tokens: 600
    })

    const raw = response.choices[0]?.message?.content?.trim() || ''
    const parsed = safeParseCandidates(raw)
    if (parsed) {
      logger.info(`[Prompt] 优化结果: candidates=${parsed.candidates.length}, recommended=${parsed.recommendedIndex}`)
      return parsed
    }

    // 模型偶尔不按 JSON 输出，进行兜底
    if (raw) {
      const fallback = buildFallbackResult(raw)
      fallback.optimizedPrompt = raw
      fallback.candidates[0] = { prompt: raw, why: '模型首选结果' }
      logger.info('[Prompt] 非 JSON 输出，已回退候选结果')
      return fallback
    }
  } catch (error) {
    logger.error(`[Prompt] 优化失败:`, error)
  }

  return buildFallbackResult(request.userMessage)
}
