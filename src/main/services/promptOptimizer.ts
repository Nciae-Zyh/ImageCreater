import OpenAI from 'openai'
import { logger } from '../utils/logger'

interface OptimizePromptRequest {
  userMessage: string
  action: 'generate' | 'edit' | 'reference'
  baseUrl: string
  apiKey: string
  model?: string
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

const EDIT_SYSTEM_PROMPT = `你是一个图片编辑 prompt 优化器。用户要对已有图片进行编辑。

规则：
1. 描述要做的修改，不要描述原图
2. 保持简洁明确
3. 语言与用户输入一致

示例：
输入：换个蓝色背景 → 将背景替换为纯蓝色，保持主体不变
输入：加个文字"Hello" → 在图片上方添加白色粗体文字"Hello"
输入：调亮一点 → 增加整体亮度和对比度`

export async function optimizePrompt(request: OptimizePromptRequest): Promise<string> {
  try {
    const client = new OpenAI({ baseURL: request.baseUrl, apiKey: request.apiKey, timeout: 30000 })

    const systemPrompt = request.action === 'reference' ? REFERENCE_SYSTEM_PROMPT
      : request.action === 'edit' ? EDIT_SYSTEM_PROMPT
      : GENERATE_SYSTEM_PROMPT

    logger.info(`[Prompt] 优化请求: action=${request.action}, input="${request.userMessage}"`)

    const response = await client.chat.completions.create({
      model: request.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.userMessage }
      ],
      temperature: 0.7,
      max_tokens: 200
    })

    const optimized = response.choices[0]?.message?.content?.trim()
    if (optimized) {
      logger.info(`[Prompt] 优化结果: "${optimized}"`)
      return optimized
    }
  } catch (error) {
    logger.error(`[Prompt] 优化失败:`, error)
  }

  return request.userMessage
}
