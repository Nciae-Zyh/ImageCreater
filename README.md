# ImageCreater

AI 驱动的跨平台图片生成与编辑桌面应用。支持文本生成图片、图片编辑、多轮对话式图片优化。

## 功能特性

- **智能意图分析** — AI 自动判断用户意图（对话/生成/编辑/分析），无需手动切换模式
- **多 Provider 支持** — OpenAI、Google Gemini、小米 MiMo 等，支持跨 Provider 调用（文本模型 + 图片模型分离配置）
- **视觉选图** — 多模态模型自动分析历史图片，精准选择编辑对象
- **内联图片选择器** — AI 无法确定时，在聊天区域内直接选择历史图片
- **流式响应** — 实时显示处理步骤、文本生成和图片生成进度
- **Markdown 渲染** — 对话内容支持富文本展示
- **日志系统** — 文件持久化、自动打码、一键导出
- **系统托盘** — macOS tooltip / Windows 托盘，快速导出日志
- **R2 存储** — 可选 Cloudflare R2 对象存储，图片云端同步
- **消息管理** — 支持删除单条消息、对话历史持久化

## 测试状态

> 当前仅测试了 **小米 MiMo (mimo-v2.5) + OpenAI gpt-image-2** 的组合。其他 Provider 组合可能存在兼容性问题，欢迎反馈。

## 开发环境

- Node.js 20+
- pnpm 9+

```bash
pnpm install
pnpm dev
```

## 打包构建

```bash
# macOS
pnpm build:mac

# macOS Apple Silicon (M1/M2/M3/M4)
pnpm build:mac:arm64

# macOS Intel
pnpm build:mac:x64

# Windows
pnpm build:win

# Linux
pnpm build:linux
```

macOS Release 产物会按架构命名：

- `ImageCreater-<version>-mac-arm64.dmg`: Apple Silicon Mac
- `ImageCreater-<version>-mac-x64.dmg`: Intel Mac

## CI 自动发布

推送 `v*` 标签自动触发 GitHub Actions 构建，生成多平台安装包并创建 Release。

```bash
git tag v1.0.3
git push origin v1.0.3
```

## 技术栈

- **前端**: React 18 + TypeScript + Ant Design + Zustand
- **桌面端**: Electron 33 + electron-vite
- **后端**: Node.js + OpenAI SDK + sql.js (SQLite)
- **存储**: Cloudflare R2 (可选)

## License

MIT
