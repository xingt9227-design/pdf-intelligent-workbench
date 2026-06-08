const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'

const taskPrompts = {
  chat: '你是论文阅读对话助手。请根据用户问题、当前论文标题、当前页文本和选中段落回答。回答要直接、清楚、用中文。无法从上下文确认的内容要说明无法确认，不要编造。',
  word: '你是论文阅读词义助手。只翻译用户给出的一个英文词或短语，结合上下文给出中文含义。输出格式必须是 英文词 中文含义，不要解释过程，不要输出整段翻译。',
  figure: '你是论文图表公式解释助手。请根据用户提供的图表、表格、公式附近原文，输出中文解释。必须包含 图表含义 关键结论 与正文关系 三部分。不要保留英文长句，不要中英混杂，不要输出 Markdown 表格。',
  translate: '你是论文翻译助手。请把用户提供的论文原文翻译成中文，保留专业术语、数据集名称、指标名称和引用编号。只输出译文。',
  summary: '你是论文阅读助手。请根据用户提供的章节内容生成中文总结。按主要内容、关键概念、方法、实验结果、结论五段输出。不要使用 Markdown 标题符号，不要输出代码块。',
  report: '你是论文阅读报告助手。请根据用户提供的论文信息、笔记和阅读状态，生成一份中文阅读报告，包含论文基本信息、章节总结、核心贡献、术语、问题清单和复习建议。不要使用 Markdown 标题符号。',
  recommend: '你是论文推荐助手。请根据用户提供的论文主题和参考文献，推荐相关论文方向、关键词和可检索的代码仓库方向。输出中文列表，不要使用 Markdown 表格。',
}

export const callAi = async ({ task, text, title, context }) => {
  const apiKey = process.env.AI_API_KEY
  const baseUrl = process.env.AI_BASE_URL || DEFAULT_BASE_URL
  const model = process.env.AI_MODEL || DEFAULT_MODEL

  if (!apiKey) {
    const error = new Error('后端未配置 AI_API_KEY')
    error.status = 400
    throw error
  }

  const systemPrompt = taskPrompts[task] || '你是论文阅读助手。请根据用户内容给出中文结果。'
  const clippedText = String(text || '').slice(0, 18000)
  const userPrompt = [
    title ? `文档标题 ${title}` : '',
    context ? `补充上下文 ${context}` : '',
    `任务类型 ${task}`,
    '正文内容',
    clippedText,
  ].filter(Boolean).join('\n\n')

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: Number(process.env.AI_TEMPERATURE || 0.2),
    }),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error?.message || `AI 请求失败 ${response.status}`)
    error.status = response.status
    throw error
  }

  return {
    text: body.choices?.[0]?.message?.content?.trim() || '',
    model,
  }
}
