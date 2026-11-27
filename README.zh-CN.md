# OpenReel Video

> **开源版 CapCut 替代品。在浏览器里完成专业视频剪辑。素材不上传，无需安装，100% 开源。**

OpenReel Video 是一款完全在客户端运行的浏览器视频编辑器：解码、合成、预览和导出都在你的设备上完成，不依赖昂贵的软件或云端转码。仓库同时包含 Electron 桌面端，以及 Studio（效果/滤镜/模板创作）、Image（图片编辑）和 Cloud（市场与协作）等应用。

**[在线体验](https://openreel.video)** | **[English](README.md)** | **[贡献指南](CONTRIBUTING.md)** | **[讨论区](https://github.com/Augani/openreel-video/discussions)** | **[Twitter](https://x.com/python_xi)**

![代码行数](https://img.shields.io/badge/Lines%20of%20Code-130k+-blue) ![License](https://img.shields.io/badge/License-MIT-green) ![Status](https://img.shields.io/badge/Status-Beta-orange) ![Open Source](https://img.shields.io/badge/Open%20Source-100%25-brightgreen) ![简体中文](https://img.shields.io/badge/UI-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-brightgreen)

---

## 为什么选择 OpenReel？

- **100% 客户端处理**：视频素材不会离开你的设备，没有上传、没有云端转码，隐私完全由你掌握。
- **浏览器版无需安装**：打开 Chrome / Edge 即可开始；需要原生能力时再使用桌面版。
- **专业级功能**：多轨时间线、关键帧动画、调色、音频效果、多机位、HDR、ProRes 导出等。
- **GPU 加速**：WebGPU 与 WebCodecs 带来流畅的 4K 预览和快速导出，WebGPU 不可用时自动回退到 Canvas2D。
- **永久免费**：MIT 许可，无订阅、无导出水印。

---

## 功能

### 视频剪辑
- **多轨时间线**：视频、音频、图片、文本、图形轨道数量不限
- **实时预览**：GPU 加速的流畅播放
- **精确剪辑**：逐帧拖动、切割、修剪、分割、波纹删除
- **转场**：交叉淡入淡出、黑场/白场、擦除、滑动等
- **视频效果**：亮度、对比度、饱和度、模糊、锐化、发光、暗角、绿幕抠像
- **混合模式**：正片叠底、滤色、叠加、相加、相减等
- **速度控制**：0.25x–4x，音频保持音高
- **裁剪与变换**：位置、缩放、旋转，支持 3D 透视

### 图形与文字
- **专业文本编辑器**：样式、阴影、描边、渐变
- **20+ 文字动画**：打字机、淡入、滑动、弹跳、弹出、弹性、故障等
- **卡拉 OK 字幕**：逐词高亮并与音频同步
- **形状工具**：矩形、圆形、箭头、多边形、星形，支持填充/描边
- **SVG 支持**：导入 SVG，支持着色与动画
- **贴纸与 Emoji**：内置素材库
- **背景生成器**：纯色、渐变、网格渐变、图案
- **关键帧动画**：任意属性随时间动画，20+ 缓动曲线

### 音频
- **多轨混音**：无限音频轨，实时混音
- **波形可视化**：可视化音频剪辑
- **音频效果**：EQ、压缩器、混响、延迟、合唱、镶边、失真
- **音量与声像**：逐片段控制，支持淡入淡出
- **节拍检测**：根据音乐自动生成标记
- **音频闪避**：对白播放时自动降低背景音乐
- **降噪**：三轮降噪（音调噪声、宽带噪声、低频轰鸣）

### 调色
- **色轮**：Lift / Gamma / Gain 控制
- **HSL 调整**：色相、饱和度、明度微调
- **曲线编辑器**：RGB 与单通道曲线
- **LUT 支持**：导入并应用 3D LUT
- **内置预设**：一键调色
- **ACES / OCIO 色彩管理**：输入变换、ACEScct 调色、输出变换

### 导出
- **MP4（H.264 / H.265）**：通用兼容
- **WebM（VP8 / VP9 / AV1）**：面向网页的格式
- **ProRes**：专业中间格式（Proxy、LT、Standard、HQ、4444）
- **质量预设**：4K @ 60fps、1080p、720p、480p
- **自定义设置**：码率、帧率、编码器、色深
- **硬件编码**：WebCodecs 快速导出
- **AI 放大**：使用 WebGPU 着色器提升分辨率
- **音频导出**：MP3、WAV、AAC、FLAC、OGG
- **图片序列**：JPG、PNG、WebP 逐帧导出
- **进度反馈**：实时进度，可取消

### 专业工具
- **无限撤销/重做**：完整历史与恢复
- **自动保存**：IndexedDB 本地存储，避免丢失工作
- **键盘快捷键**：专业剪辑工作流
- **吸附对齐**：网格与参考线磁吸
- **轨道管理**：显示/隐藏、锁定/解锁、排序
- **字幕支持**：SRT / WebVTT / SCC / MCC / EBU-STL 等导入，样式可调
- **屏幕录制**：录制屏幕、摄像头或两者
- **项目分享**：导出/导入项目文件
- **多机位剪辑**：音频同步与实时机位切换
- **嵌套序列、调整图层、蒙版、运动跟踪、HDR、插件托管**（桌面端）

### 性能
- **WebGPU 渲染**：GPU 加速合成
- **WebCodecs API**：硬件视频解码/编码
- **帧缓存**：LRU 缓存保证流畅播放
- **Web Workers**：后台处理
- **4K 支持**：4K 编辑与导出

---

## 快速开始

### 在线体验

访问 **[openreel.video](https://openreel.video)** 即可开始。

想通过聊天使用 OpenAI、Anthropic 或任意 OpenAI 兼容端点进行剪辑，请参考
**[AI 编辑器配置指南](docs/AGENT-GUIDE.md#bring-your-own-key-web--desktop-chat)**。

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/Augani/openreel-video.git
cd openreel-video

# 安装依赖（需要 Node.js 18+，推荐 22）
pnpm install

# 启动开发服务器
pnpm dev

# 打开 http://localhost:5173
```

需要自动构建 AssemblyScript WASM 时，可使用：

```bash
./start.sh   # 端口 5174
```

### 生产构建

```bash
pnpm build      # 构建 WASM + Web 应用
pnpm preview
```

### 桌面版（Electron）

```bash
pnpm --filter @openreel/desktop fetch:ffmpeg   # 首次构建前获取 ffmpeg sidecar
pnpm --filter @openreel/desktop dev            # 开发
pnpm --filter @openreel/desktop build          # 构建渲染器与主进程
pnpm --filter @openreel/desktop pack           # 生成未签名安装包
pnpm --filter @openreel/desktop dist           # 生成签名安装包
```

Linux `.deb` 可在对应架构的主机上构建：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false \
  pnpm --filter @openreel/desktop exec electron-builder --linux deb --x64
# arm64 主机使用 --arm64
```

### 其他应用

```bash
pnpm --filter @openreel/studio dev     # 效果 / 滤镜 / 模板创作
pnpm --filter @openreel/image dev      # 图片编辑器
pnpm --filter cloud dev                # Cloudflare Worker（市场 / 协作 / 崩溃上报）
pnpm --filter @openreel/agent-runner build   # 构建无头 Agent CLI
```

---

## 浏览器与系统要求

| 浏览器 | 版本 | 状态 |
| --- | --- | --- |
| Chrome | 94+ | 完整支持 |
| Edge | 94+ | 完整支持 |
| Firefox | 130+ | 完整支持 |
| Safari | 16.4+ | 完整支持 |

主流浏览器均已支持 WebCodecs，可实现硬件加速的视频编解码。

**推荐配置：**
- 8GB+ 内存（4K 剪辑建议 16GB+，参见 [已知限制](docs/known-limitations.md)）
- 4K 剪辑建议使用独立 GPU
- 现代多核 CPU

桌面版需要 Windows / macOS / Linux；Linux 构建使用 Electron 33，打包为 `.deb` 等格式。

---

## 仓库结构

```
openreel-video/
├── apps/
│   ├── web/          # React 19 + Vite + Zustand 的浏览器编辑器与 Playwright E2E
│   ├── desktop/      # Electron 外壳：主进程/预加载、原生 sidecar、本地 MCP 服务
│   ├── studio/       # 效果 / 滤镜 / 模板创作与市场发布
│   ├── image/        # 图片编辑器
│   └── cloud/        # Cloudflare Worker（Hono）：市场、Studio API、协作房间
├── packages/
│   ├── core/         # 平台无关引擎：动作、时间线、视频、音频、图形、文本、
│   │                 # 调色、运动、创建、导出、存储、媒体、多机位、插件
│   ├── ui/           # 共享 shadcn/Radix + Tailwind 组件库
│   ├── agent/        # LLM 工具注册表、回合循环与宿主接口
│   ├── agent-runner/ # 无头 Agent CLI
│   ├── collab/       # 实时协作协议（实验性）
│   ├── fxpkg/        # 效果包清单 / 编译器
│   ├── image-core/   # 图片项目模型与操作
│   ├── i18n/         # 英文源 key + 简体中文字典、translate / useT / 语言 store
│   └── creation-*/   # 原生 C++20 创作引擎、schema/bindings 与 TS CPU 参考实现
└── scripts/          # 构建、校验、i18n 检查等脚本
```

### 关键技术

- **React 19** + **TypeScript**：类型安全的 UI
- **Vite**：开发与生产构建
- **Zustand**：轻量状态管理
- **MediaBunny**：媒体处理
- **WebCodecs**：硬件编解码
- **WebGPU**：GPU 加速渲染（Canvas2D 回退）
- **Web Audio API**：专业音频处理
- **Three.js**：3D 变换与效果
- **IndexedDB**：本地项目与媒体存储
- **Electron 33**：桌面端
- **Cloudflare Workers / Durable Objects**：云服务

### 设计原则

- **基于动作的编辑**：每次编辑都是可撤销的 `Action`，撤销/重做与 AI 工具共用同一套动作
- **不可变状态**：Zustand 带来可预测的更新
- **引擎分离**：视频、音频、图形引擎相互独立
- **渐进增强**：WebGPU → Canvas2D 优雅回退
- **本地优先**：用户媒体不上传，云端功能仅为可选

---

## 简体中文界面

界面支持简体中文，默认跟随系统语言，也可在设置中手动切换：

- **Web / 桌面端**：设置 → General → Language → 跟随系统 / English / 简体中文
- **Studio / Image**：语言设置入口与各自的应用设置

实现方式：

- 共享包 `@openreel/i18n`：英文原文作为 key，`packages/i18n/src/zh-CN.json` 提供中文
- `translate()`、`useT()`（React）、`translateNow()`（非 React/toast/主进程）、语言 store
- 启动字典与完整字典分离，避免拖大首屏 bundle
- 静态检查：`pnpm check:i18n`（key 完整性、占位符一致性、重复 key）与 `pnpm check:i18n:ui`（未包裹的 JSX UI 文案）
- 用户内容（项目/轨道/片段/素材名等）与技术标识（编码器、格式、快捷键）保持原文

---

## 测试与质量

```bash
pnpm typecheck                 # 全仓 16 个项目
pnpm test                      # 单元测试（Vitest）
pnpm lint                      # ESLint
pnpm --filter @openreel/web test:e2e           # Playwright 浏览器 E2E
pnpm --filter @openreel/web bundle:budget      # 产物体积门禁
pnpm --filter @openreel/web perf:gate          # 性能/渲染次数门禁
pnpm check:i18n
pnpm check:i18n:ui
```

浏览器 E2E 需要 Google Chrome（含 H.264/AAC 编解码器）、`ffmpeg` 和 `xmllint`；缺少工具时测试会失败而不是跳过。

桌面端 E2E 为独立的环境变量门控脚本，例如：

```bash
pnpm --filter @openreel/desktop test:ingest-e2e
pnpm --filter @openreel/desktop test:prores-e2e
pnpm --filter @openreel/desktop test:hdr-e2e
```

---

## AI 辅助开发

OpenReel 也是 AI 辅助开源开发的一次实验。Claude AI 参与：

- **Issue 分诊**：审阅并回复问题
- **代码实现**：编写功能与修复缺陷
- **代码审查**：维护质量标准
- **文档维护**：保持文档更新

人类维护者 Augustus 负责战略方向与重大变更的最终审批。所有代码公开、经过测试，并遵循最佳实践。

**对贡献者意味着：**
- Issue 通常会很快得到回复（一般在 24 小时内）
- Bug 修复发布迅速
- 问题会得到清晰、详细的答复
- 保持较高的代码质量标准

---

## 参与贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

**参与方式：**
- 提交带复现步骤的 Bug
- 在 Discussions 中提出功能建议
- 提交 Bug 修复或功能 PR
- 改进文档
- 编写测试
- 分享效果预设

**开发流程：**

```bash
# Fork 并克隆
git clone https://github.com/Augani/openreel-video.git

# 创建功能分支
git checkout -b feat/your-feature

# 修改后运行检查
pnpm typecheck
pnpm test
pnpm lint

# 使用约定式提交
git commit -m "feat: add your feature"

# 推送并创建 PR
git push origin feat/your-feature
```

---

## 路线图

### 已完成
- 多轨时间线与拖放
- GPU 加速的实时预览
- 完整剪辑套件（切割、修剪、分割、转场）
- 20+ 文字动画的文本编辑器
- 图形（形状、SVG、贴纸、背景）
- 音频混音、效果与节拍检测
- 调色与 LUT
- 关键帧动画系统
- MP4 / WebM（含 4K）导出
- 屏幕录制、AI 放大、撤销/重做与自动保存
- 多机位、嵌套序列、调整图层、运动跟踪、蒙版、HDR、插件托管

### 进行中
- 协作编辑（实验性）
- 更多导出格式与编码器
- 移动端体验优化
- 插件与效果市场

### 计划中
- 更完善的音频频谱编辑
- 更多 AI 辅助创作能力
- 跨应用工作流整合

---

## 许可证

MIT License。可自由用于个人与商业项目。

详见 [LICENSE](LICENSE)。

---

## 致谢

**主要技术：**
- [MediaBunny](https://mediabunny.dev) — 媒体处理
- [React](https://react.dev) — UI 框架
- [Zustand](https://zustand-demo.pmnd.rs/) — 状态管理
- [THREE.js](https://threejs.org) — 3D 渲染
- [TailwindCSS](https://tailwindcss.com) — 样式
- [Electron](https://www.electronjs.org) — 桌面端
- [Cloudflare Workers](https://workers.cloudflare.com) — 云服务

**灵感来源：**
- DaVinci Resolve — 专业工具的典范
- CapCut — 让人人可剪辑
- Figma — 浏览器中的专业软件

---

## 支持

- **GitHub Issues** — Bug 报告与功能请求
- **GitHub Discussions** — 问题与社区交流
- **Twitter/X** — [@python_xi](https://x.com/python_xi)

---

## $OPENREEL Token

合约地址：`B7wDnfrdtvdG7SCkRjSMJ6LkVwGWvdWrQ75iV8G9pump`

---

**由 [@python_xi](https://x.com/python_xi) 与 AI 共同用心打造。**

*让每个人都能使用专业视频剪辑。永久免费，永久开源。*
