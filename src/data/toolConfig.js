export const createModes = (icons) => [
  { id: 'normal', label: 'PDF工具', icon: icons.Layers },
  { id: 'paper', label: '论文阅读模式', icon: icons.BookOpen },
]

export const createToolGroups = (icons) => [
  {
    title: '页面处理',
    tools: [
      { name: '拆分 PDF', icon: icons.Scissors, desc: '按页码范围或固定页数拆分文档' },
      { name: '合并 PDF', icon: icons.Columns3, desc: '将多个文档按顺序合成一个文件' },
      { name: '页面删除', icon: icons.FileCheck2, desc: '按页卡选择要删除的页面并生成新文件' },
      { name: '页面排序', icon: icons.ListChecks, desc: '拖拽页卡重新排列页面并导出结果' },
      { name: '页面旋转', icon: icons.RotateCw, desc: '修正横向页和扫描倒置页' },
      { name: '页面裁剪', icon: icons.SquareDashedMousePointer, desc: '按页码和边距裁剪页面并生成新版本' },
    ],
  },
  {
    title: '编辑标注',
    tools: [
      { name: '文本框', icon: icons.PenLine, desc: '在页面任意位置添加说明文字' },
      { name: '遮盖块', icon: icons.Stamp, desc: '覆盖错误内容或临时隐藏区域' },
      { name: '高亮批注', icon: icons.Highlighter, desc: '标记重点并保存评论' },
      { name: '水印签名', icon: icons.FileCheck2, desc: '添加水印、签名和交付标记' },
    ],
  },
  {
    title: '转换导出',
    tools: [
      { name: 'PDF 转 Word', icon: icons.FileText, desc: '尽量保留版式、字体、图片和表格' },
      { name: '导出记录', icon: icons.Archive, desc: '查看历史版本和转换结果' },
      { name: '任务队列', icon: icons.ListChecks, desc: '管理等待、执行、失败和重试任务' },
      { name: '文档搜索', icon: icons.Search, desc: '搜索文件名、正文和操作记录' },
    ],
  },
]

export const createLeftTabs = (icons) => [
  { id: 'outline', label: '目录', icon: icons.ListChecks },
  { id: 'bookmark', label: '书签', icon: icons.Bookmark },
  { id: 'comment', label: '注释', icon: icons.MessageSquareText },
  { id: 'thumb', label: '缩略图', icon: icons.PanelLeft },
  { id: 'search', label: '搜索替换', icon: icons.Search },
]

export const createRightTabs = (icons) => [
  { id: 'translate', label: '翻译', icon: icons.Languages },
  { id: 'summary', label: '总结', icon: icons.Sparkles },
  { id: 'notes', label: '笔记', icon: icons.NotebookPen },
  { id: 'recommend', label: '推荐', icon: icons.Lightbulb },
  { id: 'knowledge', label: '基础知识', icon: icons.Brain },
  { id: 'progress', label: '进度', icon: icons.CheckCircle2 },
  { id: 'figures', label: '图表公式', icon: icons.SquareDashedMousePointer },
  { id: 'references', label: '引用追踪', icon: icons.Quote },
  { id: 'questions', label: '问题清单', icon: icons.MessageSquareText },
  { id: 'cards', label: '重点卡片', icon: icons.Tags },
  { id: 'report', label: '阅读报告', icon: icons.FileText },
  { id: 'compare', label: '多论文对比', icon: icons.Columns3 },
  { id: 'library', label: '知识库', icon: icons.Archive },
]
