
# OpenReel Video

> **开源 CapCut 替代方案。专业级视频剪辑，浏览器即开即用。无需上传。无需安装。100% 开源。**

OpenReel Video 是一款功能完整的浏览器端视频编辑器，完全运行在客户端。基于 React、TypeScript、WebCodecs 和 WebGPU 构建，无需昂贵软件或云端处理即可实现专业级视频编辑。

**[在线体验](https://openreel.video)** | **[文档](CONTRIBUTING.md)** | **[讨论区](https://github.com/Augani/openreel-video/discussions)** | **[Twitter](https://x.com/python_xi)**

![OpenReel Editor](https://img.shields.io/badge/Lines%20of%20Code-130k+-blue) ![License](https://img.shields.io/badge/License-MIT-green) ![Status](https://img.shields.io/badge/Status-Beta-orange) ![Open Source](https://img.shields.io/badge/Open%20Source-100%25-brightgreen)

---

## 为什么选择 OpenReel？

- **100% 客户端运行** - 视频永不离开您的设备。无需上传，无云端处理，完全隐私。
- **无需安装** - 在 Chrome/Edge 中直接打开即可开始编辑。
- **专业功能** - 多轨时间线、关键帧动画、调色、音频效果等。
- **GPU 加速** - WebGPU 和 WebCodecs 实现流畅的 4K 编辑和快速导出。
- **永久免费** - MIT 许可证，无订阅，无水印。

---

## 功能特性

### 视频剪辑

- **多轨时间线** - 无限视频、音频、图片、文字和图形轨道
- **实时预览** - GPU 加速的流畅播放
- **精确剪辑** - 逐帧拖动、剪切、裁剪、分割、涟漪删除
- **转场效果** - 交叉淡化、淡入黑/白色、 wipes、滑动效果
- **视频效果** - 亮度、对比度、饱和度、模糊、锐化、发光、暗角、色度键
- **混合模式** - 正片叠底、滤色、叠加、加法、减法等
- **速度控制** - 0.25x 到 4x，音频音调保持
- **裁剪与变换** - 位置、缩放、旋转，3D 透视

### 图形与文字

- **专业文字编辑器** - 丰富样式、阴影、描边、渐变
- **20+ 文字动画** - 打字机、淡入淡出、滑动、弹跳、弹出、弹性、故障艺术
- **卡拉 OK 风格字幕** - 与音频同步的逐字高亮
- **形状工具** - 矩形、圆形、箭头、多边形、星形，支持填充/描边
- **SVG 支持** - 导入 SVG，支持颜色染色和动画
- **贴纸与表情** - 内置素材库
- **背景生成器** - 纯色、渐变、网格渐变、图案
- **关键帧动画** - 支持 20+ 缓动曲线为任意属性添加时间动画

### 音频

- **多轨混音** - 无限音频轨道，实时混音
- **波形可视化** - 可视化音频编辑
- **音频效果** - EQ、压缩器、混响、延迟、合唱、镶边、失真
- **音量与声像** - 逐片段控制，渐入渐出
- **节拍检测** - 自动生成与音乐同步的标记
- **音频闪避** - 对话播放时自动降低背景音乐
- **降噪** - 三阶段降噪（谐音、宽带、低频）

### 调色

- **色彩轮** - 提升、灰度、增益控制
- **HSL 调整** - 色调、饱和度、亮度微调
- **曲线编辑器** - RGB 及独立通道曲线
- **LUT 支持** - 导入和应用 3D LUT
- **内置预设** - 一键调色

### 导出

- **MP4 (H.264/H.265)** - 通用兼容性
- **WebM (VP8/VP9/AV1)** - Web 优化格式
- **ProRes** - 专业中间格式（Proxy、LT、Standard、HQ、4444）
- **质量预设** - 4K @ 60fps、1080p、720p、480p
- **自定义设置** - 比特率、帧率、编码器选项、色彩深度
- **硬件编码** - WebCodecs 实现快速导出
- **AI 超分** - WebGPU 着色器提升分辨率
- **音频导出** - MP3、WAV、AAC、FLAC、OGG
- **图像序列** - JPG、PNG、WebP 帧导出
- **进度追踪** - 实时进度显示，支持取消

### 专业工具

- **无限撤销/重做** - 完整历史记录和恢复
- **自动保存** - 永不丢失作品（IndexedDB 存储）
- **键盘快捷键** - 专业工作流程
- **吸附网格** - 磁性对齐
- **轨道管理** - 显示/隐藏、锁定/解锁、重排
- **字幕支持** - SRT 导入，可自定义样式
- **屏幕录制** - 录制屏幕、摄像头或两者同时
- **项目共享** - 导出/导入项目文件

### 性能

- **WebGPU 渲染** - GPU 加速合成
- **WebCodecs API** - 硬件视频解码/编码
- **帧缓存** - LRU 缓存确保流畅播放
- **Web Workers** - 后台处理
- **4K 支持** - 4K 分辨率编辑和导出

---

## 快速开始

### 在线体验

访问 **[openreel.video](https://openreel.video)** 立即开始编辑。

### 本地运行

```bash
# 克隆仓库
git clone https://github.com/Augani/openreel-video.git
cd openreel-video

# 安装依赖（需要 Node.js 18+）
pnpm install

# 启动开发服务器
pnpm dev

# 打开 http://localhost:5173
```

### 生产构建

```bash
pnpm build
pnpm preview
```

---

## 浏览器要求

| 浏览器 | 版本 | 状态 |
|--------|------|------|
| Chrome | 94+ | 完全支持 |
| Edge | 94+ | 完全支持 |
| Firefox | 130+ | 完全支持 |
| Safari | 16.4+ | 完全支持 |

所有主流浏览器现已支持 WebCodecs，实现硬件加速视频编码/解码。

**推荐配置：**
- 8GB+ 内存
- 独立显卡（用于 4K 编辑）
- 现代多核 CPU

---

## 架构设计

### Monorepo 结构

```
openreel/
├── apps/web/              # React 前端 (~66k 行代码)
│   └── src/
│       ├── components/    # UI 组件
│       │   └── editor/    # 编辑器面板（时间线、预览、检查器）
│       ├── stores/        # Zustand 状态管理
│       ├── services/      # 自动保存、快捷键、屏幕录制
│       └── bridges/       # 引擎协调
│
└── packages/core/         # 核心引擎 (~59k 行代码)
    └── src/
        ├── video/         # 视频处理、WebGPU 渲染
        ├── audio/         # Web Audio API、效果、节拍检测
        ├── graphics/      # Canvas/THREE.js、图形、SVG
        ├── text/          # 文字渲染、动画
        ├── export/        # MP4/WebM 编码
        └── storage/       # IndexedDB、序列化
```

### 核心技术栈

- **React 18** + **TypeScript** - 类型安全 UI
- **Zustand** - 轻量级状态管理
- **MediaBunny** - 视频/音频处理
- **WebCodecs** - 硬件编码/解码
- **WebGPU** - GPU 加速渲染
- **Web Audio API** - 专业音频处理
- **THREE.js** - 3D 变换和效果
- **IndexedDB** - 本地项目存储

### 设计原则

- **基于操作的编辑** - 每次编辑都是可撤销的操作
- **不可变状态** - Zustand 实现可预测的状态更新
- **引擎分离** - 视频、音频、图形引擎相互独立
- **渐进增强** - 优雅降级（WebGPU → Canvas2D）

---

## AI 管理的开发模式

OpenReel 是 AI 辅助开源开发的实验。Claude AI 协助管理：

- **问题分类** - 审查和回复 issues
- **代码实现** - 编写功能和修复 bug
- **代码审查** - 维护质量标准
- **文档更新** - 保持文档同步

Augustus 提供人工监督，确保战略方向和对重大变更的最终审批。所有代码公开、经过测试，遵循最佳实践。

**这对贡献者意味着：**
- 问题会快速审查（通常在 24 小时内）
- Bug 修复快速上线
- 清晰详细的问题回复
- 高代码质量标准

---

## 贡献指南

欢迎贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解指南。

**贡献方式：**
- 报告 bug 并提供复现步骤
- 在讨论区提出功能建议
- 提交 PR 修复 bug 或实现功能
- 改进文档
- 编写测试
- 分享效果预设

**开发工作流程：**
```bash
# Fork 并克隆
git clone https://github.com/Augani/openreel-video.git

# 创建功能分支
git checkout -b feat/your-feature

# 进行修改，然后测试
pnpm typecheck
pnpm test
pnpm lint

# 使用 conventional commits 提交
git commit -m "feat: add your feature"

# 推送并打开 PR
git push origin feat/your-feature
```

---

## 路线图

### 已完成
- 拖放式多轨时间线
- GPU 加速实时视频预览
- 完整剪辑套件（剪切、裁剪、分割、转场）
- 20+ 动画的文字编辑器
- 图形（形状、SVG、贴纸、背景）
- 音频混音（效果和节拍检测）
- LUT 支持的调色
- 关键帧动画系统
- MP4/WebM 导出（支持 4K）
- 屏幕录制
- AI 超分
- 撤销/重做与自动保存

### 进行中
- 嵌套序列（时间线中的时间线）
- 运动跟踪
- 更多导出格式（ProRes、GIF）
- 插件系统

### 计划中
- 调整图层
- 高级遮罩
- 音频频谱编辑
- 协作编辑
- 移动端优化

---

## 许可证

MIT 许可证 - 可自由用于个人和商业项目。

详见 [LICENSE](LICENSE)。

---

## 致谢

**技术栈：**
- [MediaBunny](https://mediabunny.dev) - 媒体处理
- [React](https://react.dev) - UI 框架
- [Zustand](https://zustand-demo.pmnd.rs/) - 状态管理
- [THREE.js](https://threejs.org) - 3D 渲染
- [TailwindCSS](https://tailwindcss.com) - 样式

**灵感来源：**
- DaVinci Resolve - 专业工具的正确实现
- CapCut - 人人可用的便捷编辑
- Figma - 浏览器端专业软件

---

## 支持

- **GitHub Issues** - Bug 报告和功能请求
- **GitHub Discussions** - 问题和社区交流
- **Twitter/X** - [@python_xi](https://x.com/python_xi)

---

**由 [@python_xi](https://x.com/python_xi) 和 AI 共同精心打造。**

*让专业视频编辑触手可及。永久免费。永久开源。*