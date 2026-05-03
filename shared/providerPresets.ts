import type { ProviderPreset } from './types'

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    chatModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o3-mini'],
    imageModels: ['gpt-image-2', 'gpt-image-1', 'gpt-image-1.5', 'dall-e-3'],
    visionModels: ['gpt-4o', 'gpt-4o-mini'],
    supportsVision: true,
    supportsImageEdit: true,
    description: '支持自定义 Base URL (代理/中转)。GPT-4o 视觉分析，gpt-image-2/gpt-image-1/DALL-E 3 图片生成与编辑'
  },
  {
    id: 'mimo',
    name: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    chatModels: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-flash'],
    imageModels: [],
    visionModels: ['mimo-v2.5', 'mimo-v2-omni'],
    supportsVision: true,
    supportsImageEdit: false,
    description: 'OpenAI 兼容格式。mimo-v2.5 全模态理解(图片/音频/视频)，mimo-v2.5-pro 深度推理，支持思维链'
  },
  {
    id: 'qwen',
    name: '通义千问 (Qwen)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatModels: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
    imageModels: ['wanx-v1'],
    visionModels: ['qwen-vl-max', 'qwen-vl-plus', 'qwen2.5-vl-72b-instruct'],
    supportsVision: true,
    supportsImageEdit: false,
    description: '阿里云 DashScope，Qwen-VL 图片分析，万相图片生成'
  },
  {
    id: 'zhipu',
    name: '智谱 AI (GLM)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    chatModels: ['glm-4', 'glm-4-flash', 'glm-4-plus'],
    imageModels: ['cogview-3-plus', 'cogview-4'],
    visionModels: ['glm-4v', 'glm-4v-plus'],
    supportsVision: true,
    supportsImageEdit: false,
    description: '智谱清言，GLM-4V 图片分析，CogView 图片生成'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    chatModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    imageModels: ['gemini-2.0-flash', 'imagen-3.0-generate-002'],
    visionModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    supportsVision: true,
    supportsImageEdit: true,
    description: 'Gemini 2.0+ 原生图片理解与生成'
  },
  {
    id: 'stability',
    name: 'Stability AI',
    baseUrl: 'https://api.stability.ai/v2beta',
    chatModels: [],
    imageModels: ['sd3.5-large', 'sd3.5-medium', 'sd3-large', 'stable-diffusion-xl-1024-v1-0'],
    visionModels: [],
    supportsVision: false,
    supportsImageEdit: true,
    description: '专注图片生成，支持 img2img 风格化和编辑'
  }
]

export function getPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id)
}
