# 本地 PDF 智能工作台

这是一个面向软件设计课程设计的本地 PDF 工具项目。系统把常用 PDF 处理、隐私脱敏和论文阅读集中在一个前端应用中，重点展示 PDF 文件解析、页面处理、可视化编辑、本地任务记录和论文辅助阅读流程。

## 功能模块

### 普通 PDF 工具库

- 拆分 PDF
- 合并 PDF
- 页面删除
- 页面排序
- 页面旋转
- 页面裁剪
- 文本框编辑
- 遮盖块编辑
- 高亮批注
- 水印和签名
- 文档搜索
- 基础 PDF 转 Word
- 任务队列
- 导出记录

### 隐私脱敏模式

- 手机号识别
- 邮箱识别
- 身份证号识别
- 银行卡号识别
- 脱敏任务记录
- 脱敏 PDF 生成

当前脱敏识别主要基于正则规则，适合课程设计演示。扫描版 PDF 或复杂版式 PDF 需要额外 OCR 和坐标定位能力。

### 论文阅读模式

- 真实 PDF 连续阅读
- PDF.js 文本层选择
- 目录解析和标题跳转
- 本地书签
- 本地注释
- 页面缩略图
- 搜索定位
- 选中文本翻译
- 当前章节翻译
- 整篇论文翻译
- 章节总结
- 阅读笔记
- 推荐资料
- 术语和基础知识
- 阅读进度
- 图表公式记录
- 引用追踪
- 问题清单
- 重点卡片
- 阅读报告导出
- 多论文对比演示
- 本地知识库检索

论文阅读中的翻译、总结和推荐采用本地规则和演示数据生成，没有接入在线大模型接口。

## 技术栈

- React
- Vite
- Node.js
- Express
- SQLite
- PDF.js
- pdf-lib
- docx
- JSZip
- lucide-react

## 本地运行

安装依赖。

```bash
npm install
```

启动开发服务。这个命令会同时启动前端页面和后端数据库接口。

```bash
npm run dev
```

单独启动前端。

```bash
npm run client
```

单独启动后端。

```bash
npm run server
```

## AI 接入

项目后端支持 OpenAI 兼容接口。复制 `.env.example` 为 `.env`，然后填写自己的 API 配置。

```bash
copy .env.example .env
```

`.env` 示例。

```text
AI_API_KEY=你的API密钥
AI_BASE_URL=https://rehdasu.cn/v1
AI_MODEL=gpt-5.4-mini
AI_TEMPERATURE=0.2
API_PORT=3001
```

如果使用其他 OpenAI 兼容服务，只需要改 `AI_BASE_URL` 和 `AI_MODEL`。API Key 只放在后端 `.env` 文件里，不要写到前端代码中。

当前已接入的 AI 功能包括论文翻译、章节总结、推荐生成和阅读报告生成。前端调用 `src/services/aiClient.js`，后端接口在 `server/ai.js` 和 `server/index.js`。

如果课程设计需要在前端直接看到 API 接入代码，可以在 `.env` 中填写下面这些 `VITE_` 变量。

```text
VITE_AI_API_KEY=你的API密钥
VITE_AI_BASE_URL=https://rehdasu.cn/v1
VITE_AI_MODEL=gpt-5.4-mini
VITE_AI_TEMPERATURE=0.2
```

前端直连代码在 `src/services/aiClient.js`。只要 `VITE_AI_API_KEY` 有值，前端就会直接请求模型接口。这个方式方便展示代码，但 Key 会暴露在浏览器里，不建议真实项目使用。

构建生产版本。

```bash
npm run build
```

预览构建结果。

```bash
npm run preview
```

如果系统 npm 缓存所在磁盘空间不足，可以把缓存放到项目目录。

```bash
npm --cache ./.npm-cache run build
```

## 项目结构

```text
server
├─ data
│  └─ pdf-workbench.db
├─ db.js
└─ index.js

src
├─ assets
├─ components
│  ├─ common.jsx
│  └─ tools
├─ data
│  ├─ paperData.js
│  └─ toolConfig.js
├─ services
│  └─ localDb.js
├─ utils
│  └─ download.js
├─ App.css
├─ App.jsx
├─ index.css
└─ main.jsx
```

## 实现说明

PDF 阅读器使用 PDF.js 渲染页面和文本层，阅读区采用连续滚动模式。滚动时只更新当前页码，目录、搜索结果和缩略图点击时才执行主动跳转。

PDF 处理功能主要使用 pdf-lib 操作页面、旋转、裁剪、合并、遮盖、水印和编辑元素。拆分结果使用 JSZip 打包。Word 导出使用 docx 生成基础文档。

项目提供了 Node 后端和 SQLite 数据库。后端代码在 `server` 目录，数据库文件在 `server/data/pdf-workbench.db`。前端通过 `src/services/localDb.js` 调用后端 API，保存导入文档、阅读状态、任务队列和导出记录。主要接口如下。

```text
GET    /api/health
GET    /api/documents
PUT    /api/documents/:id
POST   /api/documents/bulk
DELETE /api/documents/:id
GET    /api/tasks
GET    /api/exports
```

浏览器可以直接打开下面的地址查看当前数据库状态。

```text
http://127.0.0.1:3001/api/health
http://127.0.0.1:3001/api/documents
http://127.0.0.1:3001/api/tasks
http://127.0.0.1:3001/api/exports
```

## 已知限制

- 扫描版 PDF 暂不支持 OCR
- PDF 转 Word 只能生成基础文本和页面预览，不能完整还原复杂版式
- 自动脱敏暂未做到按识别文本坐标精确遮盖
- 翻译和总结是本地规则生成，不是真实在线 AI 结果
- 多论文对比和推荐资料包含演示型数据

## 课程设计定位

本项目适合作为 PDF 智能工作台原型，展示前端文件处理、PDF 渲染、本地存储、任务状态管理和论文阅读辅助功能。项目重点在可运行的本地交互流程，不依赖后端服务。
