export const documents = [
  {
    id: 1,
    title: 'Adaptive Retrieval for Scientific Reading.pdf',
    meta: '28 页 · 4.8 MB · 昨天导入',
    status: '阅读中',
    source: 'demo',
  },
  {
    id: 2,
    title: 'Multimodal Document Understanding.pdf',
    meta: '16 页 · 2.1 MB · 今天导入',
    status: '待处理',
    source: 'demo',
  },
  {
    id: 3,
    title: 'Local First Knowledge Workbench.pdf',
    meta: '42 页 · 7.2 MB · 5 月 29 日',
    status: '已归档',
    source: 'demo',
  },
]

export const initialTasks = [
  { id: 1, name: '章节总结', target: 'Adaptive Retrieval', state: '成功', time: '09:10' },
  { id: 2, name: 'PDF 转 Word', target: 'Local First', state: '处理中', time: '09:18' },
  { id: 3, name: '页面裁剪', target: 'Multimodal', state: '等待中', time: '09:22' },
]

export const outline = [
  { title: 'Abstract', page: 1, done: true },
  { title: '1 Introduction', page: 2, done: true },
  { title: '2 Related Work', page: 5, done: true },
  { title: '3 Method', page: 9, done: false },
  { title: '4 Experiments', page: 16, done: false },
  { title: '5 Conclusion', page: 24, done: false },
  { title: 'References', page: 26, done: false },
]

export const rightPanelContent = {
  translate: {
    title: '当前章节翻译',
    body: '本节介绍一种面向科学文献阅读的自适应检索方法。系统会依据用户当前阅读位置提取上下文，并把术语解释、段落翻译和参考资料组织在同一个阅读空间内。',
    items: ['整篇翻译', '章节翻译', '选中文本翻译', '导出译文'],
  },
  summary: {
    title: '3 Method 章节总结',
    body: '本章提出分层解析流程。文档先被切分为章节，再抽取关键段落，模型随后生成术语表、方法描述和实验准备信息。',
    items: ['主要内容', '关键概念', '研究方法', '实验结果', '结论'],
  },
  notes: {
    title: '当前页笔记',
    body: '作者把检索策略和阅读状态绑定，这一点可以作为系统设计里的观察者模式案例。任务状态变化后右侧面板随之更新。',
    items: ['重点', '待复查', '可写入报告'],
  },
  recommend: {
    title: '相关资料推荐',
    body: '系统根据标题、关键词和参考文献生成推荐列表，用户可以收藏，也可以加入待读队列。',
    items: ['Retrieval Augmented Generation', 'PDF.js annotation layer', 'Apache PDFBox text extraction', 'Scientific paper reading workflow'],
  },
  knowledge: {
    title: '需要掌握的基础知识',
    body: '当前章节涉及向量检索、章节切分、文档嵌入、评价指标和阅读状态建模。',
    items: ['Embedding', 'RAG', 'BM25', 'Citation Graph', 'F1 Score'],
  },
  progress: {
    title: '阅读进度',
    body: '当前阅读到第 9 页，位于 3 Method。摘要和相关工作已读完，方法章节正在阅读。',
    items: ['28 页中已读 9 页', '2 个章节已完成', '3 个章节待总结', '上次位置已保存'],
  },
  figures: {
    title: '图表公式笔记',
    body: '用户可以框选公式或图表区域，系统保存截图、页码、章节和解释内容。',
    items: ['公式 3.1 变量说明', '图 2 方法流程', '表 1 数据集统计'],
  },
  references: {
    title: '引用追踪',
    body: '参考文献可以加入待读列表，并和推荐资料联动形成阅读链。',
    items: ['Vaswani et al. 2017', 'Lewis et al. 2020', 'Karpukhin et al. 2020'],
  },
  questions: {
    title: '问题清单',
    body: '阅读中产生的问题会绑定页码和章节，并有未解决、已解决、忽略三种状态。',
    items: ['检索窗口为什么设为 512 token', '实验指标是否覆盖长文档场景', '消融实验是否充分'],
  },
  cards: {
    title: '重点卡片',
    body: '文字、图、公式、总结和笔记都可以保存成复习卡片。',
    items: ['核心贡献卡片', '方法流程卡片', '评价指标卡片'],
  },
  report: {
    title: '阅读报告',
    body: '系统会汇总论文信息、章节总结、核心贡献、术语表、问题清单、笔记和推荐资料。',
    items: ['生成 Word', '生成 PDF', '插入重点卡片', '附带推荐资料'],
  },
  compare: {
    title: '多论文对比',
    body: '用户选择同方向论文后，系统以表格对比研究问题、方法、数据集、指标和不足。',
    items: ['研究问题', '方法路线', '数据集', '实验指标', '优缺点'],
  },
  library: {
    title: '本地知识库',
    body: '读过的论文、术语、笔记、问题和推荐资料会进入本地知识库，支持关键词检索。',
    items: ['论文 12 篇', '笔记 58 条', '术语 126 个', '重点卡片 34 张'],
  },
}

export const chapterProgress = [
  { name: 'Abstract', percent: 100, state: '已完成' },
  { name: 'Introduction', percent: 100, state: '已完成' },
  { name: 'Related Work', percent: 82, state: '已总结' },
  { name: 'Method', percent: 46, state: '阅读中' },
  { name: 'Experiments', percent: 0, state: '未开始' },
]

export const figuresAndFormulas = [
  { type: '公式', title: '公式 3.1 检索评分函数', meta: '第 10 页 · Method · 待解释' },
  { type: '图表', title: '图 2 阅读流水线', meta: '第 11 页 · Method · 已保存截图' },
  { type: '表格', title: '表 1 数据集统计', meta: '第 17 页 · Experiments · 待整理' },
]

export const questions = [
  { text: '检索窗口为什么设为 512 token', state: '未解决' },
  { text: '实验指标是否覆盖长文档场景', state: '已解决' },
  { text: '消融实验是否充分', state: '未解决' },
]

export const reportSections = ['论文基本信息', '章节总结', '核心贡献', '术语表', '问题清单', '重点卡片', '推荐资料']

export const summaryBlocks = [
  { label: '主要内容', text: '系统将论文切分为可定位章节，并让右侧辅助内容跟随当前阅读位置刷新。' },
  { label: '关键概念', text: '章节索引、阅读状态、任务队列、证据绑定、引用链。' },
  { label: '研究方法', text: '通过页面锚点和章节语义索引建立动态阅读上下文。' },
  { label: '实验结果', text: '方法章节尚未完成实验结果抽取，系统将等待用户切换到实验章节。' },
]

export const notes = [
  { title: '设计模式线索', text: '右侧面板跟随阅读状态变化，可以作为观察者模式的业务体现。' },
  { title: '报告素材', text: '任务队列适合说明状态模式，AI 服务层适合说明策略模式。' },
]

export const recommendations = [
  { title: 'PDF.js annotation layer', type: '代码仓库', score: '92%' },
  { title: 'Retrieval Augmented Generation', type: '论文', score: '88%' },
  { title: 'Apache PDFBox text extraction', type: '技术文档', score: '84%' },
]

export const terms = [
  { term: 'RAG', desc: '检索增强生成，先检索相关资料，再生成回答。' },
  { term: 'Embedding', desc: '把文本映射成向量，便于计算语义相似度。' },
  { term: 'BM25', desc: '常见关键词检索算法，适合做基础搜索排序。' },
  { term: 'Citation Graph', desc: '用引用关系组织论文之间的关联。' },
]

export const cards = [
  { title: '核心贡献', desc: '动态阅读状态驱动翻译、总结和推荐面板。' },
  { title: '方法流程', desc: 'PDF 解析、章节识别、任务创建、AI 处理、结果归档。' },
  { title: '评价指标', desc: '阅读效率、定位准确率、推荐相关度、任务成功率。' },
]

export const compareRows = [
  { field: '研究问题', current: '动态论文阅读', other: '长文档问答' },
  { field: '方法路线', current: '章节状态驱动', other: '统一向量检索' },
  { field: '数据集', current: '论文 PDF 集合', other: '开放问答数据集' },
  { field: '不足', current: '依赖章节识别质量', other: '缺少阅读过程管理' },
]
