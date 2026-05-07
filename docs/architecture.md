# ImageCreater 程序流程图 & 统一模型适配器优化方案

## 一、整体架构总览

```mermaid
graph TB
    subgraph Renderer["渲染进程 (Renderer Process)"]
        ChatInput["ChatInput<br/>用户输入"]
        ChatPage["ChatPage.handleSend"]
        IntentPre["analyzeIntent<br/>IPC 预分析"]
        Picker["openImagePicker<br/>图片选择器"]
        useChat["useChat.sendMessage"]
        Listener["Stream Listener<br/>useChat.ts"]
        ChatMsg["ChatMessage 组件"]
    end

    subgraph Main["主进程 (Main Process)"]
        ChatIPC["ipc/chat.ts<br/>CHAT.SEND"]
        Router["aiRouter.ts<br/>routeRequest"]
        IntentAI["intentClassifier.ts<br/>classifyIntentAI"]
        Models["selectModels<br/>模型选择"]
        ChatSvc["chatService.ts<br/>sendMessage (stream)"]
        ImgSvc["imageService.ts<br/>generateImage"]
        Vision["provider.vision()"]
        Registry["Provider Registry<br/>matchProvider"]
        MiMo["MiMo Handler"]
        Gemini["Gemini Handler"]
        OpenAI["OpenAI Handler"]
    end

    ChatInput --> ChatPage
    ChatPage --> IntentPre
    IntentPre -->|"chat/analyze"| useChat
    IntentPre -->|"generate/edit"| Picker
    Picker --> useChat

    useChat -->|"IPC: CHAT.SEND"| ChatIPC
    ChatIPC --> Router
    Router --> IntentAI
    Router --> Models

    Router -->|"chat"| ChatSvc
    Router -->|"analyze"| Vision
    Router -->|"generate"| ImgSvc
    Router -->|"edit"| ImgSvc
    Router -->|"edit (fallback)"| Vision

    ChatSvc --> Registry
    ImgSvc --> Registry
    Vision --> Registry
    Registry --> MiMo
    Registry --> Gemini
    Registry --> OpenAI

    ChatSvc -->|"stream chunks"| Listener
    ChatIPC -->|"STEP/TEXT/IMAGE/META/DONE"| Listener
    Listener --> ChatMsg
```

---

## 二、前端发送 → 后端处理 时序图

```mermaid
sequenceDiagram
    actor User as 用户
    participant Input as ChatInput
    participant Page as ChatPage
    participant IPC_Analyze as analyzeIntent<br/>(IPC)
    participant Hook as useChat
    participant IPC_Send as CHAT.SEND<br/>(IPC)
    participant Chat as ipc/chat.ts
    participant Router as aiRouter.ts
    participant Intent as intentClassifier
    participant Exec as 执行层<br/>(chatService/<br/>imageService/<br/>provider)
    participant DB as SQLite

    User->>Input: 输入文字 / 上传图片
    Input->>Page: handleSend(content, imageData?)

    alt 无图片上传
        Page->>IPC_Analyze: analyzeIntent(message, providerId)
        IPC_Analyze->>Intent: classifyIntentAI()
        Intent-->>IPC_Analyze: { action, confidence, reason }
        IPC_Analyze-->>Page: intentResult

        alt action = chat / analyze
            Page->>Hook: doSend(content)
        else action = generate / edit
            Page->>Page: openImagePicker()
            Page->>User: 展示图片选择器
            User->>Page: 确认选择
            Page->>Hook: doSend(content + selectedImages)
        end
    else 有图片上传
        Page->>Hook: doSend(content, imageData)
    end

    Hook->>Hook: 创建 placeholder 消息
    Hook->>IPC_Send: invoke(CHAT.SEND, request)
    IPC_Send->>Chat: handle(event, request)

    Chat->>DB: saveMessage(user)
    Chat->>Chat: sendStream("[STEP]正在分析...")

    Chat->>Router: routeRequest(request)

    Router->>Router: getDecryptedKey(providerId)

    alt 有 imageData
        Router->>Router: intent = { action: 'edit' }
    else 无 imageData
        Router->>Intent: classifyIntentAI(message, history)
        Intent-->>Router: ClassifiedIntent
    end

    Router->>Router: selectModels(record, modelSelection)

    alt action = chat
        Router->>Exec: sendMessage() [streaming]
        loop 流式输出
            Exec-->>Chat: onChunk("[TEXT]" + chunk)
            Chat-->>Hook: STREAM event
        end
    else action = analyze
        Router->>Exec: provider.vision(images, prompt)
        Exec-->>Chat: content
    else action = generate
        Router->>Exec: imageService.generateImage(prompt)
        Exec-->>Chat: imageBase64
    else action = edit
        Router->>Router: 获取图片(上传/历史/AI选图)
        Router->>Exec: imageService → handler.editImage()
        Exec-->>Chat: imageBase64
    end

    alt needUserSelect
        Chat->>DB: saveMessage(needUserSelect=true)
        Chat-->>Hook: "[META]{needUserSelect:true}"
        Chat-->>Hook: "[DONE]"
        Hook-->>Page: 触发图片选择器
    else 正常完成
        Chat->>DB: saveImageToDisk + R2
        Chat->>DB: saveMessage(assistant)
        Chat-->>Hook: "[META]{model, duration, steps}"
        Chat-->>Hook: "[IMAGE]app-image://..."
        Chat-->>Hook: "[DONE]"
    end

    Hook->>Hook: syncAssistantMessage → conversationStore
```

---

## 三、流式协议状态机

```mermaid
stateDiagram-v2
    [*] --> Idle

    Idle --> Analyzing: 用户发送消息
    Analyzing --> Streaming: 收到 [TEXT]
    Analyzing --> ImageGen: 收到 [IMAGE]
    Analyzing --> NeedSelect: 收到 [META] needUserSelect
    Analyzing --> Error: 收到 [ERROR]
    Analyzing --> Idle: 收到 [DONE] (纯文本完成)

    Streaming --> Streaming: 收到 [TEXT]
    Streaming --> ImageGen: 收到 [IMAGE]
    Streaming --> Done: 收到 [DONE]

    ImageGen --> Done: 收到 [DONE]

    NeedSelect --> Idle: 用户确认/取消选择

    Error --> Idle: 收到 [DONE]

    Done --> Idle: isStreaming = false

    state Analyzing {
        [*] --> ShowLoading
        ShowLoading: 步骤显示 loading 图标
        ShowLoading: 文本区域等待
    }

    state Streaming {
        [*] --> ShowCursor
        ShowCursor: 文本追加 ▎ 光标
        ShowCursor: 步骤显示 loading 图标
    }

    state Done {
        [*] --> ShowComplete
        ShowComplete: 步骤显示绿色对勾
        ShowComplete: 文本正常渲染
        ShowComplete: 图片展示
    }

    state NeedSelect {
        [*] --> ShowPicker
        ShowPicker: 内联图片选择器
        ShowPicker: 3列网格 + 确认按钮
    }
```

---

## 四、意图分类决策流

```mermaid
flowchart TD
    Start([用户输入]) --> HasImage{有上传图片?}

    HasImage -->|是| EditForce["硬编码 action = edit<br/>confidence = 1.0"]

    HasImage -->|否| AIClassify["classifyIntentAI()<br/>调用 chatModel<br/>JSON 格式输出"]

    AIClassify -->|成功| ParseResult["解析 {action, confidence, reason}"]
    AIClassify -->|失败| Fallback["classifyIntentFallback()<br/>正则关键词匹配"]

    Fallback --> HasHistory{历史消息有图片?}
    HasHistory -->|是| EditKeywords{编辑关键词?}
    HasHistory -->|否| GenKeywords{生成关键词?}

    EditKeywords -->|是| EditResult["action = edit"]
    EditKeywords -->|否| AnalyzeKeywords{分析关键词?}
    AnalyzeKeywords -->|是| AnalyzeResult["action = analyze"]
    AnalyzeKeywords -->|否| GenerateResult2["action = generate"]

    GenKeywords -->|是| GenerateResult["action = generate"]
    GenKeywords -->|否| ChatResult["action = chat"]

    ParseResult --> Validate{action 有效?}
    Validate -->|是| Final([最终意图])
    Validate -->|否| DefaultChat["action = chat"]

    EditForce --> Final
    EditResult --> Final
    AnalyzeResult --> Final
    GenerateResult --> Final
    GenerateResult2 --> Final
    ChatResult --> Final
    DefaultChat --> Final
```

---

## 五、Edit 意图执行流程

```mermaid
flowchart TD
    EditStart([action = edit]) --> GetImg{用户上传了图片?}

    GetImg -->|是| UseUploaded["使用上传的图片"]
    GetImg -->|否| SearchHistory["搜索历史消息中的图片"]

    SearchHistory --> CountImg{历史图片数量}

    CountImg -->|"0 张"| DegradeGen["降级: action = generate"]
    CountImg -->|"1 张"| UseSingle["直接使用该图片"]
    CountImg -->|"多张"| AISelect["selectImageByAI()<br/>多模态模型选择"]

    AISelect --> SelectResult{选择结果}
    SelectResult -->|"index >= 0"| UseSelected["使用选中图片"]
    SelectResult -->|"-1 (无法确定)"| NeedUser["needUserSelect = true<br/>返回前端让用户选"]

    UseUploaded --> HasEdit{handler.editImage?}
    UseSingle --> HasEdit
    UseSelected --> HasEdit

    HasEdit -->|是| DoEdit["imageService → handler.editImage()<br/>生成编辑后图片"]
    HasEdit -->|否| FallbackVision["降级: vision() 文字描述<br/>如何编辑图片"]

    DegradeGen --> DoGenerate["imageService → handler.generateImage()"]
    DoEdit --> Result([返回 imageBase64])
    FallbackVision --> Result
    DoGenerate --> Result
    NeedUser --> NeedResult([返回 needUserSelect])
```

---

## 六、Provider 能力矩阵

```mermaid
graph LR
    subgraph Providers
        MiMo["MiMo<br/>mimoHandler"]
        Gemini["Gemini<br/>geminiHandler"]
        OpenAI["OpenAI Compatible<br/>openaiHandler"]
    end

    subgraph Capabilities
        Chat["chat (streaming)"]
        Vision["vision (图片理解)"]
        GenImg["generateImage (文生图)"]
        EditImg["editImage (图片编辑)"]
    end

    MiMo --> Chat
    MiMo --> Vision

    Gemini --> Chat
    Gemini --> Vision
    Gemini --> GenImg

    OpenAI --> Chat
    OpenAI --> Vision
    OpenAI --> GenImg
    OpenAI --> EditImg

    style MiMo fill:#e6f3ff
    style Gemini fill:#e6ffe6
    style OpenAI fill:#fff3e6
```

---

## 七、IPC 流式协议

| 前缀 | 含义 | 数据格式 | 前端处理 |
|------|------|---------|---------|
| `[STEP]` | 处理步骤进度 | 纯文本，如 `"正在分析..."` | `streamState.steps.push()` |
| `[TEXT]` | 文本流式输出 | 纯文本片段 | `streamState.text += chunk` |
| `[IMAGE]` | 生成的图片 URL | URL 字符串 | `streamState.imageUrl = url` |
| `[PARTIAL_IMAGE]` | 图片生成中间态 | base64 片段 | 预览渲染 |
| `[META]` | 请求元数据 | JSON: `{model, duration, steps, action, ...}` | `streamState.metadata = parsed` |
| `[ERROR]` | 错误信息 | JSON: `{message, type, code}` | `streamState.error = parsed` |
| `[DONE]` | 流结束标记 | 无数据 | `setIsStreaming(convId, false)` |

---

## 八、当前架构问题分析

### 8.1 Provider 匹配依赖 URL 正则

- `matchProvider()` 通过 baseUrl 正则匹配 handler
- 新增 Provider 需要写正则 + 注册
- URL 不标准时匹配失败，静默 fallback 到 openaiHandler
- 用户无法手动指定使用哪个 handler

### 8.2 能力矩阵不统一

- `editImage` 是可选的，降级逻辑散落在 `aiRouter.ts` 和 `imageService.ts`
- MiMo 的 `generateImage()` 直接 throw，调用方需要 try-catch

### 8.3 职责分散

- `chatService.ts` 绕过 Provider Registry，直接用 OpenAI SDK
- `aiRouter.ts` 包含大量业务逻辑（意图分类、图片选择、降级策略）
- `imageService.ts` 只是一个薄代理层

### 8.4 缺少 chat() 方法

- `chatService.ts` 的 `sendMessage()` 是独立实现，不走 ProviderHandler 接口
- 导致 chat 和 vision/generate 使用不同的消息格式和调用路径

---

## 九、统一模型适配器优化方案

### 9.1 核心设计：ProviderAdapter 接口

```typescript
// src/main/services/providers/types.ts

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail?: 'low' | 'high' | 'auto' }
}

export interface ChatOptions {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  maxTokens?: number
  onChunk?: (text: string) => void      // 流式回调
  signal?: AbortSignal                   // 取消信号
}

export interface VisionOptions {
  model: string
  prompt: string
  images: MessageImage[]
  maxTokens?: number
}

export interface ImageGenOptions {
  model: string
  prompt: string
  size?: string
  quality?: string
}

export interface ImageEditOptions {
  model: string
  prompt: string
  images: MessageImage[]
  mask?: MessageImage
}

// 能力声明 — 每个 adapter 声明自己支持什么
export interface ProviderCapabilities {
  chat: boolean            // 是否支持文本对话
  streaming: boolean       // 是否支持流式输出
  vision: boolean          // 是否支持图片理解
  imageGeneration: boolean // 是否支持文生图
  imageEdit: boolean       // 是否支持图片编辑
}

// 统一适配器接口
export interface ProviderAdapter {
  id: string
  name: string
  capabilities: ProviderCapabilities

  // 必须实现
  chat(options: ChatOptions): Promise<string>
  vision(options: VisionOptions): Promise<string>

  // 按能力实现（capabilities 中声明 true 才会调用）
  generateImage?(options: ImageGenOptions): Promise<Buffer>
  editImage?(options: ImageEditOptions): Promise<Buffer>
}
```

### 9.2 Provider 适配器实现示例

```typescript
// src/main/services/providers/adapters/openai.adapter.ts

export class OpenAIAdapter implements ProviderAdapter {
  id = 'openai'
  name = 'OpenAI Compatible'
  capabilities = {
    chat: true,
    streaming: true,
    vision: true,
    imageGeneration: true,
    imageEdit: true
  }

  private client: OpenAI

  constructor(baseUrl: string, apiKey: string) {
    this.client = new OpenAI({ baseURL: baseUrl, apiKey })
  }

  async chat(options: ChatOptions): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model: options.model,
      messages: options.messages,
      stream: !!options.onChunk,
      temperature: options.temperature,
      max_tokens: options.maxTokens
    })

    if (options.onChunk) {
      let full = ''
      for await (const chunk of stream as AsyncIterable<any>) {
        const text = chunk.choices[0]?.delta?.content || ''
        if (text) {
          full += text
          options.onChunk(text)
        }
      }
      return full
    }
    return (stream as any).choices[0].message.content
  }

  async vision(options: VisionOptions): Promise<string> {
    const content: ContentPart[] = options.images.map(img => ({
      type: 'image_url' as const,
      image_url: {
        url: img.data.startsWith('data:')
          ? img.data
          : `data:${img.mimeType};base64,${img.data}`,
        detail: 'high' as const
      }
    }))
    content.push({ type: 'text', text: options.prompt })

    const res = await this.client.chat.completions.create({
      model: options.model,
      messages: [{ role: 'user', content }],
      max_tokens: options.maxTokens || 4096
    })
    return res.choices[0].message.content || ''
  }

  async generateImage(options: ImageGenOptions): Promise<Buffer> {
    const res = await this.client.images.generate({
      model: options.model,
      prompt: options.prompt,
      size: options.size as any,
      quality: options.quality as any
    })
    const data = res.data[0]
    if (data.b64_json) return Buffer.from(data.b64_json, 'base64')
    const resp = await fetch(data.url!)
    return Buffer.from(await resp.arrayBuffer())
  }

  async editImage(options: ImageEditOptions): Promise<Buffer> {
    const imageFiles = await Promise.all(
      options.images.map(img =>
        toFile(Buffer.from(img.data, 'base64'), null, { type: img.mimeType })
      )
    )
    const res = await this.client.images.edit({
      model: options.model,
      prompt: options.prompt,
      image: imageFiles.length === 1 ? imageFiles[0] : imageFiles
    })
    const data = res.data[0]
    if (data.b64_json) return Buffer.from(data.b64_json, 'base64')
    const resp = await fetch(data.url!)
    return Buffer.from(await resp.arrayBuffer())
  }
}
```

```typescript
// src/main/services/providers/adapters/gemini.adapter.ts

export class GeminiAdapter implements ProviderAdapter {
  id = 'gemini'
  name = 'Google Gemini'
  capabilities = {
    chat: true,
    streaming: true,
    vision: true,
    imageGeneration: true,
    imageEdit: false   // Gemini 原生 API 暂不支持编辑
  }

  private baseUrl: string
  private apiKey: string

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  async chat(options: ChatOptions): Promise<string> {
    const client = new OpenAI({
      baseURL: this.baseUrl + '/openai',
      apiKey: this.apiKey
    })
    // 同 OpenAI adapter 逻辑
  }

  async vision(options: VisionOptions): Promise<string> {
    // 同上，用 OpenAI 兼容层
  }

  async generateImage(options: ImageGenOptions): Promise<Buffer> {
    const url = `${this.baseUrl}/models/${options.model}:generateContent`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: options.prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: '1:1' }
        }
      })
    })
    const data = await resp.json()
    const b64 = data.candidates[0].content.parts[0].inlineData.data
    return Buffer.from(b64, 'base64')
  }
}
```

```typescript
// src/main/services/providers/adapters/mimo.adapter.ts

export class MiMoAdapter implements ProviderAdapter {
  id = 'mimo'
  name = 'Xiaomi MiMo'
  capabilities = {
    chat: true,
    streaming: true,
    vision: true,
    imageGeneration: false,
    imageEdit: false
  }

  async vision(options: VisionOptions): Promise<string> {
    const content: ContentPart[] = [
      // MiMo 特殊要求：图片在前
      ...options.images.map(img => ({
        type: 'image_url' as const,
        image_url: {
          url: `data:${img.mimeType};base64,${img.data}`,
          detail: 'high' as const
        }
      })),
      { type: 'text', text: options.prompt }
    ]
    // ...
  }
}
```

### 9.3 Adapter 注册中心（替代现有 Registry）

```typescript
// src/main/services/providers/adapterRegistry.ts

const adapterFactories: Map<string, (baseUrl: string, apiKey: string) => ProviderAdapter> = new Map()

adapterFactories.set('openai-compatible', (b, k) => new OpenAIAdapter(b, k))
adapterFactories.set('gemini', (b, k) => new GeminiAdapter(b, k))
adapterFactories.set('mimo', (b, k) => new MiMoAdapter(b, k))

export function registerAdapter(
  id: string,
  factory: (baseUrl: string, apiKey: string) => ProviderAdapter
) {
  adapterFactories.set(id, factory)
}

export function getAdapter(
  providerId: string,
  baseUrl: string,
  apiKey: string
): ProviderAdapter {
  // 1. 精确匹配 providerId
  const factory = adapterFactories.get(providerId)
  if (factory) return factory(baseUrl, apiKey)

  // 2. URL 模式匹配（兼容旧逻辑）
  for (const [id, fac] of adapterFactories) {
    const patterns: Record<string, RegExp> = {
      'mimo': /xiaomimimo\.com/,
      'gemini': /googleapis\.com|generativelanguage/,
      'openai-compatible': /openai\.com|dashscope|bigmodel\.cn|deepseek|moonshot|01\.ai/
    }
    if (patterns[id]?.test(baseUrl)) return fac(baseUrl, apiKey)
  }

  // 3. 默认 OpenAI 兼容
  return new OpenAIAdapter(baseUrl, apiKey)
}
```

### 9.4 简化后的 Router

```typescript
// src/main/services/aiRouter.ts (重构后)

export async function routeRequest(request: RouterRequest): Promise<RouterResponse> {
  const { baseUrl, apiKey, record } = await getDecryptedKey(request.providerId)
  const adapter = getAdapter(record.id || request.providerId, baseUrl, apiKey)

  const intent = await classify(request)
  const models = selectModels(record, request.modelSelection)

  const checkCap = (cap: keyof ProviderCapabilities) => {
    if (!adapter.capabilities[cap]) {
      throw new Error(`${adapter.name} 不支持 ${cap}`)
    }
  }

  switch (intent.action) {
    case 'chat':
      checkCap('chat')
      return await handleChat(adapter, models, request)

    case 'analyze':
      checkCap('vision')
      return await handleAnalyze(adapter, models, request)

    case 'generate':
      checkCap('imageGeneration')
      return await handleGenerate(adapter, models, request)

    case 'edit':
      return await handleEdit(adapter, models, request)
  }
}
```

### 9.5 优化后的架构流

```mermaid
graph TB
    subgraph Router["aiRouter.ts"]
        direction TB
        R1["routeRequest()"] --> R2["getDecryptedKey()"]
        R2 --> R3["getAdapter(providerId)"]
        R3 --> R4["classifyIntent()"]
        R4 --> R5["selectModels()"]
        R5 --> R6{"intent.action"}
    end

    R6 -->|chat| ChatH["handleChat()"]
    R6 -->|analyze| AnalyzeH["handleAnalyze()"]
    R6 -->|generate| GenH["handleGenerate()"]
    R6 -->|edit| EditH["handleEdit()"]

    ChatH --> Adapter["ProviderAdapter"]
    AnalyzeH --> Adapter
    GenH --> Adapter
    EditH --> Adapter

    subgraph Adapters["adapters/"]
        OA["OpenAIAdapter<br/>chat ✓ vision ✓<br/>generate ✓ edit ✓"]
        GA["GeminiAdapter<br/>chat ✓ vision ✓<br/>generate ✓ edit ✗"]
        MA["MiMoAdapter<br/>chat ✓ vision ✓<br/>generate ✗ edit ✗"]
    end

    Adapter --> OA
    Adapter --> GA
    Adapter --> MA

    style Adapters fill:#f9f9f9,stroke:#333
    style Router fill:#f0f8ff,stroke:#333
```

### 9.6 迁移路径

```mermaid
gantt
    title 迁移计划
    dateFormat  YYYY-MM-DD
    section Phase 1 - 并行
    定义 ProviderAdapter 接口      :a1, 2026-05-08, 1d
    实现 OpenAIAdapter             :a2, after a1, 1d
    实现 GeminiAdapter             :a3, after a1, 1d
    实现 MiMoAdapter               :a4, after a1, 1d
    adapterRegistry 注册中心       :a5, after a2, 1d
    section Phase 2 - 改造
    aiRouter 改用 adapter          :b1, after a5, 2d
    删除 chatService.ts            :b2, after b1, 1d
    删除 imageService.ts           :b3, after b1, 1d
    section Phase 3 - 清理
    删除旧 ProviderHandler 接口    :c1, after b2, 1d
    删除 providers/registry.ts     :c2, after c1, 1d
    删除各 handler 文件            :c3, after c1, 1d
```

### 9.7 方案对比

| 维度 | 当前架构 | 统一适配器方案 |
|------|---------|--------------|
| 新增 Provider | 写 Handler + 正则 + 注册 | 实现 Adapter 接口 + 注册 |
| 能力检查 | try-catch + throw | `capabilities` 声明，前置检查 |
| chat 调用 | 绕过 Handler，独立实现 | 统一 `adapter.chat()` |
| 降级策略 | 散落在 Router/Service | 在 Router 中按 `capabilities` 统一处理 |
| 流式输出 | chatService 独立管理 | `adapter.chat({ onChunk })` 统一回调 |
| 测试性 | 难以 mock（依赖多） | 接口清晰，易于 mock |
| 代码量 | 分散在 5+ 文件 | 集中在 adapters/ + router |

### 9.8 关键决策点

1. **chat() 是否纳入 Adapter？**
   - 建议纳入。当前 `chatService.ts` 绕过 Handler 体系，导致 chat 和其他操作走不同路径
   - 统一后，`adapter.chat()` 成为唯一入口，流式回调通过 `onChunk` 参数传递

2. **返回值用 Buffer 还是 base64？**
   - 建议用 Buffer。适配器层负责统一输出，Router 层按需转换（存盘/R2/转 base64 给前端）

3. **是否保留 URL 正则匹配？**
   - 建议保留作为 fallback。主路径用 `providerId` 精确匹配，确保用户配置的 provider 一定使用正确的 adapter

4. **MiMo 的图片顺序特殊处理放在哪？**
   - 放在 `MiMoAdapter.vision()` 内部。这是 Provider 特有的实现细节，不应暴露给调用方
