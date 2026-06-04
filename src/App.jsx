import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'
import JSZip from 'jszip'
import {
  Archive,
  BookMarked,
  BookOpen,
  Bookmark,
  Brain,
  CheckCircle2,
  ChevronRight,
  Columns3,
  Download,
  Edit3,
  FileCheck2,
  FileText,
  Highlighter,
  Languages,
  Layers,
  Lightbulb,
  ListChecks,
  LockKeyhole,
  MessageSquareText,
  NotebookPen,
  PanelLeft,
  PanelRight,
  PenLine,
  Quote,
  RotateCw,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  SquareDashedMousePointer,
  Stamp,
  Tags,
  Upload,
  Wand2,
} from 'lucide-react'
import {
  cards,
  chapterProgress,
  compareRows,
  documents,
  figuresAndFormulas,
  initialTasks,
  notes,
  outline,
  questions,
  recommendations,
  reportSections,
  rightPanelContent,
  summaryBlocks,
  terms,
} from './data/paperData'
import { createLeftTabs, createModes, createPrivacyTools, createRightTabs, createToolGroups } from './data/toolConfig'
import { IconButton, ResultPanel, TaskCenter } from './components/common'
import { CropBoxEditor } from './components/tools/CropBoxEditor'
import { OverlayBoxEditor } from './components/tools/OverlayBoxEditor'
import { TextHighlightEditor } from './components/tools/TextHighlightEditor'
import { TextBoxEditor } from './components/tools/TextBoxEditor'
import { WatermarkEditor } from './components/tools/WatermarkEditor'
import { localDb } from './services/localDb'
import { buildDocxBlobFromPdfPages, buildDocxBlobFromText, downloadBlob } from './utils/download'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const iconMap = {
  Archive,
  BookOpen,
  Bookmark,
  Brain,
  CheckCircle2,
  Columns3,
  FileCheck2,
  FileText,
  Highlighter,
  Languages,
  Layers,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  NotebookPen,
  PanelLeft,
  PenLine,
  Quote,
  RotateCw,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  SquareDashedMousePointer,
  Stamp,
  Tags,
  Wand2,
}

const modes = createModes(iconMap)
const toolGroups = createToolGroups(iconMap)
const privacyTools = createPrivacyTools(iconMap)
const leftTabs = createLeftTabs(iconMap)
const rightTabs = createRightTabs(iconMap)
const PAPER_PARSE_VERSION = 2

const getDefaultToolOptions = (toolName) => ({
  mode: toolName === '页面旋转' ? 'range' : 'single',
  fromPage: '1',
  toPage: 'end',
  rotateDirection: 'right',
  textValue: 'New text box',
  watermarkText: 'PDF Workbench',
  searchKeyword: 'method',
  margin: '30',
  targetPage: '1',
  boxX: '48',
  boxY: '120',
  boxWidth: '210',
  boxHeight: '32',
  addPageNumbers: false,
})

const makeTime = () => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

const hexToPdfRgb = (hex, fallback = '#f1d6d6') => {
  const value = (hex || fallback).replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16) / 255
  const green = Number.parseInt(value.slice(2, 4), 16) / 255
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255
  return rgb(red, green, blue)
}

const createTextBoxImage = async (box, scaleX, scaleY) => {
  const canvas = document.createElement('canvas')
  const width = Math.max(1, Math.round(box.width * scaleX * 2))
  const height = Math.max(1, Math.round(box.height * scaleY * 2))
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  const fontSize = Math.max(6, box.fontSize * scaleY * 2)
  context.clearRect(0, 0, width, height)
  if (box.background && box.background !== 'transparent') {
    context.globalAlpha = 0.9
    context.fillStyle = box.background
    context.fillRect(0, 0, width, height)
    context.globalAlpha = 1
  }
  context.globalAlpha = box.opacity ?? 1
  context.fillStyle = box.color || '#35568a'
  context.font = `${box.italic ? 'italic ' : ''}${box.bold ? '700 ' : '400 '}${fontSize}px ${box.fontFamily === 'TimesRoman' ? 'Times New Roman' : box.fontFamily}`
  context.textBaseline = 'top'
  context.textAlign = box.align || 'left'
  const anchorX = box.align === 'center' ? width / 2 : box.align === 'right' ? width - 8 : 8
  String(box.text || '').split('\n').forEach((line, index) => {
    context.fillText(line, anchorX, 6 + index * fontSize * 1.25, width - 16)
  })
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob.arrayBuffer()
}

const normalizeLine = (value = '') => String(value).replace(/\s+/g, ' ').trim()

const splitSentences = (text = '') => normalizeLine(text)
  .split(/(?<=[.!?。！？])\s+/)
  .map((item) => item.trim())
  .filter(Boolean)

const isHeadingLine = (line) => {
  if (!line || line.length > 120) return false
  if (/^(abstract|references|bibliography|acknowledg(e)?ments?)$/i.test(line)) return true
  if (/^\d+(?:\.\d+){0,3}\.?\s+[A-Z][A-Za-z0-9,()\-:/& ]{2,110}$/.test(line)) return true
  if (/^[A-Z][A-Za-z0-9,()\-:/& ]{2,80}$/.test(line) && !/[.!?]$/.test(line)) return true
  if (/^(introduction|related work|method|methods|approach|experiments?|results?|discussion|conclusion|limitations)$/i.test(line)) return true
  return false
}

const cleanHeadingTitle = (line) => normalizeLine(line).replace(/\s+/g, ' ')

const getHeadingLevel = (heading = '') => {
  const match = heading.match(/^(\d+(?:\.\d+){0,3})\.?\s+/)
  if (!match) return /abstract|references|bibliography/i.test(heading) ? 1 : 0
  return match[1].split('.').length
}

const extractPdfPages = async (bytes) => {
  if (!bytes) return []
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes).slice() })
  const pdf = await loadingTask.promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const lineMap = new Map()
    textContent.items.forEach((item) => {
      const y = Math.round(item.transform?.[5] || 0)
      const x = item.transform?.[4] || 0
      const fontSize = Math.hypot(item.transform?.[2] || 0, item.transform?.[3] || 0) || Math.abs(item.transform?.[0] || 0)
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y).push({ x, text: item.str, fontSize, height: item.height || fontSize })
    })
    const lineObjects = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([y, items]) => {
        const sorted = items.sort((a, b) => a.x - b.x)
        return {
          y,
          text: normalizeLine(sorted.map((item) => item.text).join(' ')),
          fontSize: Math.max(...sorted.map((item) => item.fontSize || 0)),
          x: Math.min(...sorted.map((item) => item.x || 0)),
        }
      })
      .filter((line) => line.text)
    const lines = lineObjects.map((line) => line.text)
    pages.push({
      page: pageNumber,
      lines,
      lineObjects,
      text: lines.join('\n'),
    })
  }
  return pages
}

const resolvePdfDestination = async (pdf, destination) => {
  if (!destination) return null
  const explicitDestination = typeof destination === 'string'
    ? await pdf.getDestination(destination)
    : destination
  if (!explicitDestination?.[0]) return null
  try {
    const page = await pdf.getPageIndex(explicitDestination[0])
    const y = typeof explicitDestination[3] === 'number' ? explicitDestination[3] : null
    return { page: page + 1, y }
  } catch {
    return null
  }
}

const flattenNativeOutline = async (pdf, items = [], level = 1, result = []) => {
  for (const item of items) {
    const destination = await resolvePdfDestination(pdf, item.dest)
    const title = cleanHeadingTitle(item.title || '')
    if (title && destination?.page) {
      result.push({
        title,
        page: destination.page,
        y: destination.y,
        kind: 'section',
        level,
      })
    }
    if (item.items?.length) {
      await flattenNativeOutline(pdf, item.items, level + 1, result)
    }
  }
  return result
}

const extractNativeOutline = async (bytes) => {
  if (!bytes) return []
  const loadingTask = pdfjsLib.getDocument({
    data: cloneBytesForPdfJs(bytes),
    isEvalSupported: false,
    useWorkerFetch: false,
  })
  try {
    const pdf = await loadingTask.promise
    const nativeOutline = await pdf.getOutline()
    if (!nativeOutline?.length) return []
    const flattened = await flattenNativeOutline(pdf, nativeOutline)
    const seen = new Set()
    return flattened.filter((item) => {
      const key = `${item.title.toLowerCase()}-${item.page}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  } finally {
    loadingTask.destroy?.()
  }
}

const renderPdfPageImage = async (bytes, pageNumber = 1, maxWidth = 880) => {
  const loadingTask = pdfjsLib.getDocument({
    data: cloneBytesForPdfJs(bytes),
    isEvalSupported: false,
    useWorkerFetch: false,
  })
  const pdf = await loadingTask.promise
  const safePageNumber = Math.max(1, Math.min(pageNumber, pdf.numPages))
  const page = await pdf.getPage(safePageNumber)
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = Math.min(maxWidth / baseViewport.width, 1.8)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { alpha: false })
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport }).promise
  loadingTask.destroy?.()
  return {
    page: safePageNumber,
    dataUrl: canvas.toDataURL('image/png'),
    imageBytes: await new Promise((resolve) => {
      canvas.toBlob(async (blob) => resolve(await blob.arrayBuffer()), 'image/png')
    }),
    imageWidth: canvas.width,
    imageHeight: canvas.height,
  }
}

const renderPdfThumbs = async (bytes, maxPages = 12) => {
  const loadingTask = pdfjsLib.getDocument({
    data: cloneBytesForPdfJs(bytes),
    isEvalSupported: false,
    useWorkerFetch: false,
  })
  const pdf = await loadingTask.promise
  const thumbs = []
  const count = Math.min(pdf.numPages, maxPages)
  for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 0.18 })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    thumbs.push({ page: pageNumber, dataUrl: canvas.toDataURL('image/png') })
  }
  loadingTask.destroy?.()
  return thumbs
}

const sensitivePatterns = [
  { type: '手机号', regex: /1[3-9]\d{9}/g },
  { type: '邮箱', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: '身份证号', regex: /\d{17}[\dXx]/g },
  { type: '银行卡号', regex: /\b\d{16,19}\b/g },
]

const findSensitiveMatches = (pages = []) => pages.flatMap((page) => (
  sensitivePatterns.flatMap((pattern) => (
    Array.from(page.text.matchAll(pattern.regex)).map((match) => ({
      type: pattern.type,
      value: match[0],
      page: page.page,
    }))
  ))
))

const createPageLineRedactions = (pages = [], matches = []) => {
  const valuesByPage = matches.reduce((map, item) => {
    if (!map.has(item.page)) map.set(item.page, new Set())
    map.get(item.page).add(item.value)
    return map
  }, new Map())
  return pages.flatMap((page) => {
    const values = valuesByPage.get(page.page)
    if (!values?.size) return []
    return page.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => Array.from(values).some((value) => line.includes(value)))
      .map(({ index }) => ({
        page: page.page,
        lineIndex: index,
        lineCount: page.lines.length || 1,
      }))
  })
}

const buildKnowledgeItems = (documentsForIndex, paperState) => {
  const localItems = documentsForIndex.flatMap((doc) => {
    const data = doc.paperData
    if (!data) return []
    return [
      { type: '论文', title: data.title, detail: data.abstract || doc.meta },
      ...(data.terms || []).map((term) => ({ type: '术语', title: term.term, detail: term.desc })),
      ...(data.references || []).slice(0, 8).map((ref) => ({ type: '引用', title: ref.title, detail: data.title })),
      ...(data.sections || []).slice(0, 8).map((section) => ({ type: '章节', title: section.title, detail: normalizeLine(section.text).slice(0, 120) })),
    ]
  })
  const stateItems = [
    ...(paperState.cards || []).map((card) => ({ type: '卡片', title: card.title, detail: card.desc })),
    ...(paperState.bookmarks || []).map((item) => ({ type: '书签', title: item, detail: '阅读位置' })),
    ...(paperState.comments || []).map((item) => ({ type: '注释', title: item, detail: '阅读批注' })),
    ...(paperState.notes ? [{ type: '笔记', title: '当前阅读笔记', detail: paperState.notes }] : []),
  ]
  return [...localItems, ...stateItems]
}

const comparePaperDocuments = (documentsForCompare) => {
  const parsed = documentsForCompare.filter((doc) => doc.paperData).slice(0, 3)
  if (parsed.length < 2) return compareRows
  const [current, other] = parsed
  const currentData = current.paperData
  const otherData = other.paperData
  const keywordOverlap = (currentData.keywords || []).filter((keyword) => (otherData.keywords || []).includes(keyword))
  return [
    { field: '论文题目', current: currentData.title, other: otherData.title },
    { field: '章节数量', current: `${currentData.sections?.length || 0} 个章节`, other: `${otherData.sections?.length || 0} 个章节` },
    { field: '关键词交集', current: keywordOverlap.join('、') || '未发现明显交集', other: keywordOverlap.length ? '存在相同研究主题' : '主题差异较大' },
    { field: '方法线索', current: makeLocalSummary(getCurrentSection(currentData, 1), currentData).method, other: makeLocalSummary(getCurrentSection(otherData, 1), otherData).method },
    { field: '引用规模', current: `${currentData.references?.length || 0} 条参考文献`, other: `${otherData.references?.length || 0} 条参考文献` },
  ]
}

const extractTitleFromFirstPage = (pages, fallback) => {
  const firstLines = pages[0]?.lines || []
  const candidates = firstLines
    .filter((line) => line.length >= 18 && line.length <= 140)
    .filter((line) => !/^(cvf|abstract|keywords|arxiv|proceedings|this iccv paper)/i.test(line))
    .filter((line) => !/[{}@]/.test(line))
  return candidates[0] || fallback?.replace(/\.pdf$/i, '') || '未命名论文'
}

const extractAbstract = (pages) => {
  const joined = pages.slice(0, 3).map((page) => page.text).join('\n')
  const match = joined.match(/abstract\s*([\s\S]*?)(?=\n\s*(?:1\.?\s*)?(?:introduction|related work)\b)/i)
  if (match?.[1]) return normalizeLine(match[1]).slice(0, 1800)
  const firstText = normalizeLine(pages[0]?.text || '')
  return firstText.slice(0, 900)
}

const extractReferences = (pages) => {
  const all = pages.map((page) => page.text).join('\n')
  const referenceText = all.split(/\n\s*(?:references|bibliography)\s*\n/i).pop() || ''
  return referenceText
    .split(/\n+/)
    .map(normalizeLine)
    .filter((line) => line.length > 28)
    .filter((line) => /\b(19|20)\d{2}\b|\[\d+\]|et al\.|arxiv|github/i.test(line))
    .slice(0, 12)
    .map((title, index) => ({
      id: index + 1,
      title,
      saved: false,
    }))
}

const extractOutline = (pages, title, abstract) => {
  const outlineItems = [{ title, page: 1, kind: 'title' }]
  if (abstract) outlineItems.push({ title: 'Abstract', page: 1, kind: 'section' })
  pages.forEach((page) => {
    const bodyFont = median((page.lineObjects || []).map((line) => line.fontSize).filter(Boolean))
    ;(page.lineObjects || page.lines.map((text) => ({ text, fontSize: bodyFont }))).forEach((line) => {
      const heading = cleanHeadingTitle(line.text)
      const numbered = /^\d+(?:\.\d+){0,3}\.?\s+/.test(heading)
      const looksLikeLargeHeading = bodyFont && line.fontSize >= bodyFont * 1.12 && isHeadingLine(heading)
      if ((numbered || looksLikeLargeHeading || isHeadingLine(heading)) && !outlineItems.some((item) => item.title.toLowerCase() === heading.toLowerCase())) {
        outlineItems.push({
          title: heading,
          page: page.page,
          kind: 'section',
          level: getHeadingLevel(heading),
          y: line.y,
        })
      }
    })
  })
  if (!outlineItems.some((item) => /references|bibliography/i.test(item.title))) {
    const refPage = pages.find((page) => /references|bibliography/i.test(page.text))?.page
    if (refPage) outlineItems.push({ title: 'References', page: refPage, kind: 'section', level: 1 })
  }
  return outlineItems.sort((a, b) => a.page === b.page ? (b.y || 0) - (a.y || 0) : a.page - b.page)
}

const median = (values = []) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const extractTerms = (pages) => {
  const text = pages.map((page) => page.text).join(' ')
  const known = ['CNN', 'Transformer', 'ImageNet', 'DOTA', 'FAIR1M', 'HRSCO2016', 'mAP', 'LSKNet', 'remote sensing', 'object detection']
  const phraseCounts = new Map()
  const phraseRegex = /\b(?:[A-Z][A-Za-z0-9-]+|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z0-9-]+|of|for|and|in|with|Network|Detection|Dataset|Metric)){0,4}\b/g
  ;[...text.matchAll(phraseRegex)].forEach((match) => {
    const term = normalizeLine(match[0])
    if (term.length < 3 || term.length > 48) return
    phraseCounts.set(term, (phraseCounts.get(term) || 0) + 1)
  })
  known.forEach((term) => {
    if (new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
      phraseCounts.set(term, (phraseCounts.get(term) || 0) + 3)
    }
  })
  return Array.from(phraseCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([term, count]) => ({
      term,
      count,
      desc: `该术语在文档中出现 ${count} 次。阅读时建议结合摘要、方法和实验章节理解它的作用。`,
    }))
}

const buildSections = (pages, outlineItems) => {
  return outlineItems.map((item, index) => {
    const next = outlineItems[index + 1]
    const selectedPages = pages.filter((page) => page.page >= item.page && (!next || page.page < next.page))
    const text = selectedPages.map((page) => page.text).join('\n')
    return {
      ...item,
      endPage: next ? Math.max(item.page, next.page - 1) : pages.length,
      text: text || pages[item.page - 1]?.text || '',
    }
  })
}

const buildPaperData = (pages, fallbackTitle, nativeOutline = []) => {
  const title = extractTitleFromFirstPage(pages, fallbackTitle)
  const abstract = extractAbstract(pages)
  const parsedOutline = extractOutline(pages, title, abstract)
  const nativeItems = nativeOutline
    .filter((item) => item.page >= 1 && item.page <= pages.length)
    .sort((a, b) => a.page === b.page ? (b.y || 0) - (a.y || 0) : a.page - b.page)
  const outlineItems = nativeItems.length > 0
    ? [
      { title, page: 1, kind: 'title', level: 0 },
      ...(!nativeItems.some((item) => /abstract/i.test(item.title)) && abstract
        ? [{ title: 'Abstract', page: 1, kind: 'section', level: 1 }]
        : []),
      ...nativeItems,
    ]
    : parsedOutline
  const sections = buildSections(pages, outlineItems)
  const references = extractReferences(pages)
  const terms = extractTerms(pages)
  const keywords = terms.slice(0, 8).map((item) => item.term)
  return {
    title,
    abstract,
    outline: outlineItems,
    sections,
    references,
    terms,
    keywords,
    pageTexts: pages,
    parseVersion: PAPER_PARSE_VERSION,
    parsedAt: new Date().toISOString(),
  }
}

const withTimeout = (promise, milliseconds, message) => (
  Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), milliseconds)
    }),
  ])
)

const cloneBytesForPdfJs = (bytes) => new Uint8Array(bytes).slice()

const getCurrentSection = (paperData, currentPage = 1) => {
  const sections = paperData?.sections || []
  return [...sections].reverse().find((item) => currentPage >= item.page) || sections[0] || null
}

const cleanPdfExtractedText = (text = '') => String(text)
  .replace(/([A-Za-z])-\s+([a-z])/g, '$1$2')
  .replace(/\s*-\s+/g, '-')
  .replace(/\s+([,.;:!?])/g, '$1')
  .replace(/([([{])\s+/g, '$1')
  .replace(/\s+([)\]}])/g, '$1')
  .replace(/\s+/g, ' ')
  .trim()

const translateTerms = [
  [/remote sensing object detection/gi, '遥感目标检测'],
  [/oriented bounding boxes?/gi, '旋转边界框'],
  [/prior knowledge/gi, '先验知识'],
  [/remote sensing scenarios?/gi, '遥感场景'],
  [/long-range context/gi, '长距离上下文'],
  [/lightweight/gi, '轻量级'],
  [/large selective kernel network|lsknet/gi, '大选择核网络 LSKNet'],
  [/receptive field/gi, '感受野'],
  [/selective kernel mechanisms?/gi, '选择核机制'],
  [/object detection/gi, '目标检测'],
  [/deep learning/gi, '深度学习'],
  [/aerial images?/gi, '航拍图像'],
  [/high-resolution/gi, '高分辨率'],
  [/low-resolution/gi, '低分辨率'],
  [/pan-sharpening/gi, '全色锐化'],
  [/multispectral images?/gi, '多光谱图像'],
  [/frequency domain/gi, '频域'],
  [/framework/gi, '框架'],
  [/module/gi, '模块'],
  [/benchmark/gi, '基准测试'],
  [/state-of-the-art/gi, '当前先进水平'],
]

const translateAcademicSentence = (sentence = '') => {
  const clean = cleanPdfExtractedText(sentence)
  if (!clean) return ''
  const lower = clean.toLowerCase()
  const termText = translateTerms.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), clean)
  const namedEntities = Array.from(new Set(clean.match(/\b[A-Z][A-Za-z0-9-]{2,}\b/g) || []))
    .filter((item) => !/^(This|The|In|On|To|For|Although|However|Recent|Such|Without|Our|Code)$/i.test(item))
    .slice(0, 4)

  if (/recent research|recent years|has largely focused/.test(lower)) {
    return `近期研究主要关注${termText.includes('遥感目标检测') ? '遥感目标检测' : '相关任务'}中的关键表示能力提升，但仍存在上下文建模和先验知识利用不足的问题。`
  }
  if (/overlooked|ignored|not been/.test(lower)) {
    return '现有方法对场景中的独特先验信息考虑不足，这会限制模型在复杂目标和长距离依赖场景中的判别能力。'
  }
  if (/this paper|we propose|we present|we introduce/.test(lower)) {
    return `本文提出${namedEntities[0] ? ` ${namedEntities[0]} ` : '一种'}方法，用于增强目标表征、上下文建模和特征自适应能力。`
  }
  if (/can be useful|can vary|different objects/.test(lower)) {
    return '这些先验信息具有实际价值，因为不同目标所需的上下文范围并不相同，模型需要根据对象类型动态调整感受野。'
  }
  if (/without|mistakenly|incorrect/.test(lower)) {
    return '如果缺少足够的上下文参照，模型容易把相似外观的目标误检或混淆。'
  }
  if (/dynamically adjust|adapt/.test(lower)) {
    return '该方法能够动态调整大空间感受野，从而更好地模拟不同目标的测距和上下文关系。'
  }
  if (/experiments|datasets|benchmark|mAP|accuracy|scores/.test(lower)) {
    return `实验结果表明，该方法在多个数据集和基准指标上取得了较强表现${namedEntities.length ? `，相关对象包括 ${namedEntities.join('、')}` : ''}。`
  }
  if (/code|github/.test(lower)) {
    return '作者说明代码将公开发布，便于后续复现和比较。'
  }
  if (/figure|shown|illustrated/.test(lower)) {
    return '图示内容用于说明方法流程、上下文差异或实验现象。'
  }
  if (/because|therefore|thus|as a consequence/.test(lower)) {
    return '该句主要解释了研究问题产生的原因以及方法设计的动机。'
  }
  return `该句主要表达 ${termText.slice(0, 120)}。`
}

const makeLocalTranslation = (text = '', title = '') => {
  const cleaned = cleanPdfExtractedText(text)
  const sentences = splitSentences(cleaned).slice(0, 10)
  if (sentences.length === 0) return '当前范围暂未提取到可翻译文本。'
  const translated = sentences.map(translateAcademicSentence).filter(Boolean)
  return [
    `本地规则译文。本段来自 ${title || '当前论文'}。`,
    ...translated,
    '当前版本未接入在线翻译引擎，译文采用术语表和论文句型规则生成，适合课程设计演示。'
  ].join('')
}

const makeLocalSummary = (section, paperData) => {
  const sentences = splitSentences(section?.text || paperData?.abstract || '')
  const termsText = (paperData?.terms || []).slice(0, 6).map((item) => item.term).join('，') || '待补充'
  return {
    main: sentences.slice(0, 2).join(' ') || '当前章节文本较少，建议检查 PDF 是否为扫描件。',
    concepts: termsText,
    method: sentences.find((item) => /method|approach|network|model|framework/i.test(item)) || '该部分暂未识别到明确的方法描述。',
    experiment: sentences.find((item) => /experiment|dataset|benchmark|result|mAP|accuracy/i.test(item)) || '该部分暂未识别到明确的实验描述。',
    conclusion: sentences.slice(-2).join(' ') || '该部分暂未形成明确结论。',
  }
}

const makeRecommendations = (paperData) => {
  const keywordItems = (paperData?.keywords || []).slice(0, 5).map((keyword) => ({
    title: `${keyword} 相关论文与代码仓库`,
    type: '关键词推荐',
    score: '本地匹配',
  }))
  const referenceItems = (paperData?.references || []).slice(0, 5).map((ref) => ({
    title: ref.title,
    type: '参考文献',
    score: '引用追踪',
  }))
  return [...keywordItems, ...referenceItems].slice(0, 8)
}

const makeReadingReport = (paperData, paperState, aiOutputs) => {
  const section = getCurrentSection(paperData, paperState.currentPage)
  const summary = makeLocalSummary(section, paperData)
  return [
    `论文题目 ${paperData?.title || '未解析'}`,
    `摘要 ${paperData?.abstract || '未提取到摘要'}`,
    `当前章节 ${section?.title || '未定位'}`,
    `主要内容 ${summary.main}`,
    `关键概念 ${summary.concepts}`,
    `方法流程 ${summary.method}`,
    `实验结论 ${summary.experiment}`,
    `个人笔记 ${paperState.notes}`,
    aiOutputs.summary ? `生成总结 ${aiOutputs.summary}` : '',
  ].filter(Boolean).join('\n')
}

function App() {
  const [mode, setMode] = useState('paper')
  const [leftTab, setLeftTab] = useState('outline')
  const [rightTab, setRightTab] = useState('translate')
  const [documentList, setDocumentList] = useState(documents)
  const [activeDocumentId, setActiveDocumentId] = useState(documents[0].id)
  const [tasks, setTasks] = useState(initialTasks)
  const [importMessage, setImportMessage] = useState('请选择 PDF 文件')
  const [readerResetKey, setReaderResetKey] = useState(0)
  const [searchResults, setSearchResults] = useState([])
  const [redactionResults, setRedactionResults] = useState([])
  const [redactionPlan, setRedactionPlan] = useState([])
  const [aiOutputs, setAiOutputs] = useState({})
  const [activeTool, setActiveTool] = useState(null)
  const [toolFiles, setToolFiles] = useState([])
  const [toolPageCards, setToolPageCards] = useState([])
  const [exportRecords, setExportRecords] = useState([])
  const [paperState, setPaperState] = useState({
    currentPage: 1,
    currentPageText: '',
    currentPageTextPage: null,
    bookmarks: ['方法章节', '实验设置', '结论段落'],
    comments: ['第 3 页摘要批注', '第 9 页方法问题', '第 17 页实验备注'],
    searchKeyword: 'method',
    notes: '这里记录当前章节的新想法，可以绑定页码、章节或选中文本。',
    figures: figuresAndFormulas,
    references: rightPanelContent.references.items.map((item) => ({ title: item, saved: false })),
    libraryKeyword: 'retrieval reading state',
    navigationTarget: null,
  })
  const activeMode = modes.find((item) => item.id === mode)
  const rightContent = useMemo(() => rightPanelContent[rightTab], [rightTab])
  const activeDocument = documentList.find((doc) => doc.id === activeDocumentId) || documentList[0]
  const readerStateKey = useMemo(() => JSON.stringify({
    currentPage: paperState.currentPage,
    bookmarks: paperState.bookmarks,
    comments: paperState.comments,
    notes: paperState.notes,
    selectedText: paperState.selectedText,
    selectionPage: paperState.selectionPage,
    translationMode: paperState.translationMode,
    cards: paperState.cards,
  }), [paperState])

  useEffect(() => {
    if (!activeDocument?.readerState) return
    const timer = window.setTimeout(() => {
      setPaperState((current) => ({
        ...current,
        ...activeDocument.readerState,
      }))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeDocumentId, activeDocument?.readerState])

  useEffect(() => {
    const documentSnapshot = documentList.find((doc) => doc.id === activeDocumentId)
    if (mode !== 'paper' || !documentSnapshot?.source || documentSnapshot.source !== 'local') return
    const timer = window.setTimeout(() => {
      localDb.put(localDb.stores.documents, {
        ...documentSnapshot,
        readerState: JSON.parse(readerStateKey),
        url: undefined,
      })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [mode, activeDocumentId, documentList, readerStateKey])

  useEffect(() => {
    let cancelled = false
    const loadLocalData = async () => {
      const [savedDocuments, savedTasks, savedExports] = await Promise.all([
        localDb.list(localDb.stores.documents),
        localDb.list(localDb.stores.tasks),
        localDb.list(localDb.stores.exports),
      ])
      if (cancelled) return
      if (savedDocuments.length > 0) {
        const restoredDocuments = savedDocuments.map((doc) => ({
          ...doc,
          url: doc.bytes ? URL.createObjectURL(new Blob([doc.bytes], { type: 'application/pdf' })) : undefined,
        }))
        setDocumentList((current) => [...restoredDocuments, ...current.filter((doc) => doc.source !== 'local')])
        setActiveDocumentId(restoredDocuments[0].id)
        restoredDocuments
          .filter((doc) => doc.bytes && doc.paperData?.parseVersion !== PAPER_PARSE_VERSION)
          .forEach((doc) => {
            parsePaperDocument(doc)
          })
      }
      if (savedTasks.length > 0) setTasks(savedTasks.reverse())
      if (savedExports.length > 0) setExportRecords(savedExports.reverse())
    }
    loadLocalData()
    return () => {
      cancelled = true
    }
  }, [])

  const addTask = (name, state = '等待中') => {
    const target = activeDocument?.title?.replace('.pdf', '') || '未选择文档'
    const time = makeTime()
    const task = { id: Date.now(), name, target, state, time }
    setTasks((current) => [
      task,
      ...current,
    ])
    localDb.put(localDb.stores.tasks, task)
  }

  const addExportRecord = (name, target = activeDocument?.title || '当前文档', type = 'PDF', blob = null, mimeType = 'application/pdf') => {
    const record = {
      id: Date.now(),
      name,
      target,
      type,
      mimeType,
      blob,
      size: blob?.size || 0,
      time: makeTime(),
      state: '成功',
    }
    setExportRecords((current) => [
      record,
      ...current,
    ])
    localDb.put(localDb.stores.exports, record)
  }

  function updateDocument(id, patch) {
    setDocumentList((current) => current.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)))
  }

  const downloadBytes = (bytes, filename, type = 'application/pdf') => {
    const blob = new Blob([bytes], { type })
    downloadBlob(blob, filename)
    addExportRecord(filename, activeDocument?.title || filename, type.includes('word') ? 'Word' : type.includes('text') ? 'Text' : 'PDF', blob, type)
  }

  const downloadDocxFromText = async (text, filename) => {
    const blob = await buildDocxBlobFromText(text)
    downloadBlob(blob, filename)
    addExportRecord(filename, activeDocument?.title || filename, 'Word', blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  }

  const downloadDocxFromPdf = async (bytes, filename, sourceTitle = activeDocument?.title || filename) => {
    const pages = await extractPdfPages(bytes)
    const exportPages = []
    const maxPages = Math.min(pages.length, 20)
    for (let index = 0; index < maxPages; index += 1) {
      const image = await renderPdfPageImage(bytes, pages[index].page, 760)
      exportPages.push({
        ...pages[index],
        imageBytes: image.imageBytes,
        imageWidth: Math.min(520, image.imageWidth),
        imageHeight: Math.round((Math.min(520, image.imageWidth) / image.imageWidth) * image.imageHeight),
      })
    }
    const blob = await buildDocxBlobFromPdfPages(exportPages)
    downloadBlob(blob, filename)
    addExportRecord(filename, sourceTitle, 'Word', blob, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return pages.length > maxPages ? `已导出前 ${maxPages} 页，长文档建议分段转换` : '已导出版式预览和可复制文本'
  }

  const exportCurrentResult = async () => {
    if (mode === 'paper') {
      const reportText = activeDocument?.paperData
        ? makeReadingReport(activeDocument.paperData, paperState, aiOutputs)
        : [
          `阅读文档 ${activeDocument?.title || '未选择文档'}`,
          `当前页 ${paperState.currentPage}`,
          `笔记 ${paperState.notes}`,
          `书签 ${paperState.bookmarks.join('，')}`,
          `注释 ${paperState.comments.join('，')}`,
        ].join('\n')
      await downloadDocxFromText(reportText, `${activeDocument?.title?.replace('.pdf', '') || '阅读记录'}.docx`)
      addTask('导出阅读记录', '成功')
      return
    }
    if (activeDocument?.bytes) {
      downloadBytes(activeDocument.bytes, `${activeDocument.title.replace('.pdf', '')}-导出.pdf`)
      addTask('导出当前 PDF', '成功')
      return
    }
    addTask('导出结果需要先导入文档', '等待中')
  }

  const extractTextFromBytes = async (bytes) => {
    if (!bytes) return ''
    const pages = await extractPdfPages(bytes)
    return pages.map((page) => `第 ${page.page} 页 ${page.text}`).join('\n')
  }

  const extractText = async (doc = activeDocument) => extractTextFromBytes(doc?.bytes)

  const runPdfTool = async (toolName) => {
    if (!activeDocument?.bytes) {
      addTask(`${toolName} 需要先导入真实 PDF`, '等待中')
      return
    }

    addTask(toolName, '处理中')
    const pdfDoc = await PDFDocument.load(activeDocument.bytes)

    if (toolName === '合并 PDF') {
      addTask('合并 PDF 需要进入工具页上传多个 PDF', '等待中')
      return
    }

    if (toolName === '页面删除') {
      if (pdfDoc.getPageCount() > 1) {
        pdfDoc.removePage(pdfDoc.getPageCount() - 1)
      }
      const bytes = await pdfDoc.save()
      downloadBytes(bytes, `${activeDocument.title.replace('.pdf', '')}-删除页面.pdf`)
      addTask('页面删除完成', '成功')
      return
    }

    if (toolName === '页面排序') {
      if (pdfDoc.getPageCount() > 1) {
        const pages = await PDFDocument.create()
        const indices = pdfDoc.getPageIndices().reverse()
        const copiedPages = await pages.copyPages(pdfDoc, indices)
        copiedPages.forEach((page) => pages.addPage(page))
        const bytes = await pages.save()
        downloadBytes(bytes, `${activeDocument.title.replace('.pdf', '')}-倒序版.pdf`)
        addTask('页面排序完成', '成功')
        return
      }
      addTask('页面排序至少需要 2 页', '等待中')
      return
    }

    if (toolName === '拆分 PDF') {
      const nextDoc = await PDFDocument.create()
      const [firstPage] = await nextDoc.copyPages(pdfDoc, [0])
      nextDoc.addPage(firstPage)
      const bytes = await nextDoc.save()
      downloadBytes(bytes, `${activeDocument.title.replace('.pdf', '')}-拆分页.pdf`)
      addTask('拆分 PDF 完成', '成功')
      return
    }

    if (toolName === '页面旋转') {
      const firstPage = pdfDoc.getPage(0)
      firstPage.setRotation(degrees(90))
      const bytes = await pdfDoc.save()
      downloadBytes(bytes, `${activeDocument.title.replace('.pdf', '')}-旋转版.pdf`)
      addTask('页面旋转完成', '成功')
      return
    }

    if (toolName === '水印签名') {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      pdfDoc.getPages().forEach((page) => {
        const { width, height } = page.getSize()
        page.drawText('PDF Workbench', {
          x: width / 2 - 120,
          y: height / 2,
          size: 34,
          font,
          color: rgb(0.54, 0.61, 0.76),
          rotate: degrees(30),
          opacity: 0.35,
        })
      })
      const bytes = await pdfDoc.save()
      downloadBytes(bytes, `${activeDocument.title.replace('.pdf', '')}-水印版.pdf`)
      addTask('水印签名完成', '成功')
      return
    }

    if (['文本框', '遮盖块', '高亮批注', '页面裁剪'].includes(toolName)) {
      const targetTool = toolGroups
        .flatMap((group) => group.tools)
        .find((tool) => tool.name === toolName)
      if (targetTool) setActiveTool(targetTool)
      addTask(`${toolName}需要在工具页可视化编辑`, '等待中')
      return
    }

    if (toolName === '文档搜索') {
      try {
        const text = await extractText()
        const matches = text
          .split('\n')
          .filter((line) => /pdf|method|document|论文|方法/i.test(line))
          .slice(0, 8)
        setSearchResults(matches.length > 0 ? matches : ['当前 PDF 未命中检索词'])
        addTask('文档搜索完成', '成功')
      } catch {
        setSearchResults(['文本提取失败，扫描版 PDF 可能需要 OCR'])
        addTask('文档搜索失败', '等待中')
      }
      return
    }

    if (toolName === 'PDF 转 Word') {
      const message = await downloadDocxFromPdf(activeDocument.bytes, `${activeDocument.title.replace('.pdf', '')}.docx`, activeDocument.title)
      if (message.includes('前')) addTask(message, '成功')
      addTask('PDF 转 Word 完成', '成功')
      return
    }

    addTask(`${toolName} 需要进入工具页上传 PDF`, '等待中')
  }

  const resolvePageIndices = (pageCount, options = {}) => {
    if (options.mode === 'all') {
      return Array.from({ length: pageCount }, (_, index) => index)
    }
    if (options.mode === 'range') {
      const from = Math.max(1, Number.parseInt(options.fromPage, 10) || 1)
      const rawTo = String(options.toPage || '').trim().toLowerCase()
      const to = rawTo === 'end' || rawTo === '' ? pageCount : Number.parseInt(rawTo, 10) || pageCount
      const start = Math.min(from, pageCount)
      const end = Math.min(Math.max(to, start), pageCount)
      return Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index)
    }
    return [0]
  }

  const resolveSelectedPages = (pageCount, options = {}, pageCardsForRun = []) => {
    const selectedFromCards = pageCardsForRun
      .filter((page) => page.selected && !page.removed)
      .map((page) => page.page - 1)
    if (selectedFromCards.length > 0) return selectedFromCards
    return resolvePageIndices(pageCount, options)
  }

  const runSingleFileTool = async (toolName, file, options = {}, pageCardsForRun = []) => {
    const previousTitle = activeDocument?.title
    const tempDoc = {
      title: file.name,
      bytes: file.bytes,
    }
    const pdfDoc = await PDFDocument.load(tempDoc.bytes.slice(0))
    addTask(toolName, '处理中')

    if (toolName === '拆分 PDF') {
      if (options.mode === 'single') {
        const zip = new JSZip()
        for (const pageIndex of pdfDoc.getPageIndices()) {
          const singlePageDoc = await PDFDocument.create()
          const [page] = await singlePageDoc.copyPages(pdfDoc, [pageIndex])
          singlePageDoc.addPage(page)
          zip.file(`${file.name.replace('.pdf', '')}-第${pageIndex + 1}页.pdf`, await singlePageDoc.save())
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' })
        const url = URL.createObjectURL(zipBlob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${file.name.replace('.pdf', '')}-逐页拆分.zip`
        anchor.click()
        URL.revokeObjectURL(url)
      } else {
        const nextDoc = await PDFDocument.create()
        const selectedPages = resolveSelectedPages(pdfDoc.getPageCount(), options, pageCardsForRun)
        const copiedPages = await nextDoc.copyPages(pdfDoc, selectedPages)
        copiedPages.forEach((page) => nextDoc.addPage(page))
        downloadBytes(await nextDoc.save(), `${file.name.replace('.pdf', '')}-拆分页.pdf`)
      }
      addTask('拆分 PDF 完成', '成功')
      return
    }

    if (toolName === '页面旋转') {
      const selectedPages = resolveSelectedPages(pdfDoc.getPageCount(), options, pageCardsForRun)
      const angle = options.rotateDirection === 'left' ? 270 : options.rotateDirection === 'upside' ? 180 : 90
      selectedPages.forEach((pageIndex) => pdfDoc.getPage(pageIndex).setRotation(degrees(angle)))
      downloadBytes(await pdfDoc.save(), `${file.name.replace('.pdf', '')}-旋转版.pdf`)
      addTask('页面旋转完成', '成功')
      return
    }

    if (toolName === '页面裁剪') {
      const targetPage = Math.min(Math.max(Number.parseInt(options.targetPage, 10) || 1, 1), pdfDoc.getPageCount()) - 1
      const page = pdfDoc.getPage(targetPage)
      const { width, height } = page.getSize()
      if (options.cropBox?.pageWidth && options.cropBox?.pageHeight) {
        if (options.cropBox.width <= 0 || options.cropBox.height <= 0) {
          throw new Error('裁剪范围无效，请重新拖动裁剪框')
        }
        const scaleX = width / options.cropBox.pageWidth
        const scaleY = height / options.cropBox.pageHeight
        const cropX = Math.max(0, options.cropBox.x * scaleX)
        const cropWidth = Math.min(width - cropX, options.cropBox.width * scaleX)
        const cropHeight = Math.min(height, options.cropBox.height * scaleY)
        const cropY = Math.max(0, height - (options.cropBox.y * scaleY) - cropHeight)
        page.setCropBox(cropX, cropY, cropWidth, cropHeight)
      } else {
        throw new Error('请等待 PDF 页面显示后再生成裁剪结果')
      }
      downloadBytes(await pdfDoc.save(), `${file.name.replace('.pdf', '')}-裁剪版.pdf`)
      addTask('页面裁剪完成', '成功')
      return
    }

    if (toolName === '页面删除') {
      const removedPages = pageCardsForRun.filter((page) => page.removed || page.selected).map((page) => page.page)
      const pagesToRemove = removedPages.length > 0 ? removedPages : [pdfDoc.getPageCount()]
      pagesToRemove.sort((a, b) => b - a).forEach((pageNumber) => {
        if (pageNumber >= 1 && pageNumber <= pdfDoc.getPageCount() && pdfDoc.getPageCount() > 1) {
          pdfDoc.removePage(pageNumber - 1)
        }
      })
      downloadBytes(await pdfDoc.save(), `${file.name.replace('.pdf', '')}-删除页面.pdf`)
      addTask('页面删除完成', '成功')
      return
    }

    if (toolName === '页面排序') {
      if (pdfDoc.getPageCount() > 1) {
        const pages = await PDFDocument.create()
        const order = pageCardsForRun.length > 0
          ? pageCardsForRun.filter((page) => !page.removed).map((page) => page.page - 1)
          : pdfDoc.getPageIndices().reverse()
        const copied = await pages.copyPages(pdfDoc, order)
        copied.forEach((page) => pages.addPage(page))
        downloadBytes(await pages.save(), `${file.name.replace('.pdf', '')}-倒序版.pdf`)
        addTask('页面排序完成', '成功')
        return
      }
      addTask(`${previousTitle || file.name} 页面排序至少需要 2 页`, '等待中')
      return
    }

    if (toolName === '水印签名') {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      const visualWatermark = options.watermark
      if (!visualWatermark) {
        throw new Error('请先在预览区设置水印')
      }
      const targetPageIndex = Math.min(Math.max(Number.parseInt(options.targetPage, 10) || 1, 1), pdfDoc.getPageCount()) - 1
      const pages = visualWatermark.applyToAllPages ? pdfDoc.getPages() : [pdfDoc.getPage(targetPageIndex)]
      pages.forEach((page) => {
        const { width: pdfWidth, height: pdfHeight } = page.getSize()
        const scaleX = pdfWidth / visualWatermark.pageWidth
        const scaleY = pdfHeight / visualWatermark.pageHeight
        const drawWatermark = (x, y) => {
          page.drawText(visualWatermark.text || 'PDF Workbench', {
            x,
            y,
            size: visualWatermark.fontSize || 26,
            font,
            color: hexToPdfRgb(visualWatermark.color, '#8b9bc1'),
            rotate: degrees(visualWatermark.rotation || 0),
            opacity: visualWatermark.opacity ?? 0.28,
          })
        }
        if (visualWatermark.layout === 'tile') {
          const gapX = (Number(visualWatermark.gapX) || 250) * scaleX
          const gapY = (Number(visualWatermark.gapY) || 150) * scaleY
          for (let y = -gapY; y <= pdfHeight + gapY; y += gapY) {
            for (let x = -gapX; x <= pdfWidth + gapX; x += gapX) {
              drawWatermark(x, y)
            }
          }
          return
        }
        drawWatermark(visualWatermark.x * scaleX, pdfHeight - (visualWatermark.y * scaleY))
      })
      downloadBytes(await pdfDoc.save(), `${file.name.replace('.pdf', '')}-水印版.pdf`)
      addTask('水印签名完成', '成功')
      return
    }

    if (toolName === '文本框') {
      const targetPage = Math.min(Math.max(Number.parseInt(options.targetPage, 10) || 1, 1), pdfDoc.getPageCount()) - 1
      const page = pdfDoc.getPage(targetPage)
      const { width: pdfWidth, height: pdfHeight } = page.getSize()
      const visualTextBoxes = Array.isArray(options.textBoxes) ? options.textBoxes : []
      if (visualTextBoxes.length === 0) {
        throw new Error('请先在预览区添加文本框')
      }
      for (const box of visualTextBoxes) {
        const scaleX = pdfWidth / box.pageWidth
        const scaleY = pdfHeight / box.pageHeight
        const x = box.x * scaleX
        const yTop = box.y * scaleY
        const width = box.width * scaleX
        const height = box.height * scaleY
        const imageBytes = await createTextBoxImage(box, scaleX, scaleY)
        const image = await pdfDoc.embedPng(imageBytes)
        page.drawImage(image, {
          x,
          y: pdfHeight - yTop - height,
          width,
          height,
          rotate: degrees(box.rotation || 0),
        })
      }
      downloadBytes(await pdfDoc.save(), `${file.name.replace('.pdf', '')}-文本框.pdf`)
      addTask('文本框写入完成', '成功')
      return
    }

    if (toolName === '遮盖块') {
      const targetPage = Math.min(Math.max(Number.parseInt(options.targetPage, 10) || 1, 1), pdfDoc.getPageCount()) - 1
      const page = pdfDoc.getPage(targetPage)
      const { width: pdfWidth, height: pdfHeight } = page.getSize()
      const visualBoxes = Array.isArray(options.overlayBoxes) ? options.overlayBoxes : []
      if (visualBoxes.length > 0) {
        visualBoxes.forEach((box) => {
          const scaleX = pdfWidth / box.pageWidth
          const scaleY = pdfHeight / box.pageHeight
          const x = box.x * scaleX
          const width = box.width * scaleX
          const height = box.height * scaleY
          const y = pdfHeight - (box.y * scaleY) - height
          page.drawRectangle({
            x,
            y,
            width,
            height,
            color: hexToPdfRgb(box.color),
          })
        })
      } else {
        throw new Error('请先在预览区添加遮盖块')
      }
      downloadBytes(await pdfDoc.save(), `${file.name.replace('.pdf', '')}-遮盖块.pdf`)
      addTask('遮盖块写入完成', '成功')
      return
    }

    if (toolName === '高亮批注') {
      const targetPage = Math.min(Math.max(Number.parseInt(options.targetPage, 10) || 1, 1), pdfDoc.getPageCount()) - 1
      const page = pdfDoc.getPage(targetPage)
      const { width: pdfWidth, height: pdfHeight } = page.getSize()
      const visualHighlights = Array.isArray(options.highlightBoxes) ? options.highlightBoxes : []
      if (visualHighlights.length === 0) {
        throw new Error('请先在预览区拖选文字并保存高亮批注')
      }
      visualHighlights.forEach((highlight) => {
        const rects = Array.isArray(highlight.rects) ? highlight.rects : [highlight]
        rects.forEach((rect) => {
          const scaleX = pdfWidth / rect.pageWidth
          const scaleY = pdfHeight / rect.pageHeight
          const x = rect.x * scaleX
          const width = rect.width * scaleX
          const height = rect.height * scaleY
          const y = pdfHeight - (rect.y * scaleY) - height
          page.drawRectangle({
            x,
            y,
            width,
            height,
            color: hexToPdfRgb(highlight.color || rect.color, '#ffafba'),
            opacity: highlight.opacity ?? rect.opacity ?? 0.45,
          })
        })
      })
      downloadBytes(await pdfDoc.save(), `${file.name.replace('.pdf', '')}-高亮批注.pdf`)
      addTask('高亮批注写入完成', '成功')
      return
    }

    if (toolName === 'PDF 转 Word') {
      const message = await downloadDocxFromPdf(file.bytes, `${file.name.replace('.pdf', '')}.docx`, file.name)
      if (message.includes('前')) addTask(message, '成功')
      addTask('PDF 转 Word 完成', '成功')
      return
    }

    if (toolName === '文档搜索') {
      const text = await extractTextFromBytes(file.bytes)
      const keyword = options.searchKeyword || 'method'
      const matches = text
        .split('\n')
        .filter((line) => line.toLowerCase().includes(keyword.toLowerCase()))
        .slice(0, 8)
      setSearchResults(matches.length > 0 ? matches : [`当前 PDF 未命中关键词 ${keyword}`])
      addTask('文档搜索完成', '成功')
      return
    }

    await runPdfTool(toolName)
  }

  const runToolWithFiles = async (toolName, files = toolFiles, options = {}, pageCardsForRun = []) => {
    if (files.length === 0) {
      await runPdfTool(toolName)
      return
    }

    addTask(toolName, '处理中')

    if (toolName === '合并 PDF') {
      const merged = await PDFDocument.create()
      for (const file of files) {
        const source = await PDFDocument.load(file.bytes.slice(0))
        const pages = await merged.copyPages(source, source.getPageIndices())
        pages.forEach((page) => merged.addPage(page))
      }
      if (options.addPageNumbers) {
        const font = await merged.embedFont(StandardFonts.Helvetica)
        merged.getPages().forEach((page, index) => {
          const { width } = page.getSize()
          page.drawText(String(index + 1), {
            x: width - 48,
            y: 28,
            size: 11,
            font,
            color: rgb(0.21, 0.34, 0.54),
          })
        })
      }
      const bytes = await merged.save()
      downloadBytes(bytes, '合并结果.pdf')
      addTask('合并 PDF 完成', '成功')
      return
    }

    if (toolName !== '合并 PDF') {
      await runSingleFileTool(toolName, files[0], options, pageCardsForRun)
      return
    }

    addTask(`${toolName} 已准备执行`, '等待中')
  }

  const exportRedactedPdf = async () => {
    if (!activeDocument?.bytes) {
      addTask('生成脱敏 PDF 需要先导入文档', '等待中')
      return
    }
    addTask('生成脱敏 PDF', '处理中')
    const pdfDoc = await PDFDocument.load(activeDocument.bytes.slice(0))
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const pages = pdfDoc.getPages()
    const plan = redactionPlan.length > 0
      ? redactionPlan
      : pages.map((_, index) => ({ page: index + 1, lineIndex: 0, lineCount: 1 }))
    plan.forEach((item) => {
      const page = pages[item.page - 1]
      if (!page) return
      const { width, height } = page.getSize()
      const usableTop = height - 82
      const usableHeight = Math.max(120, height - 150)
      const lineGap = usableHeight / Math.max(1, item.lineCount)
      const y = Math.max(42, usableTop - item.lineIndex * lineGap)
      page.drawRectangle({
        x: 36,
        y,
        width: Math.min(width - 72, width * 0.82),
        height: Math.max(14, Math.min(24, lineGap * 0.75)),
        color: rgb(0.95, 0.84, 0.84),
      })
      page.drawText(`Redacted sensitive line on page ${item.page}`, {
        x: 46,
        y: y + 5,
        size: 11,
        font,
        color: rgb(0.21, 0.34, 0.54),
      })
    })
    const bytes = await pdfDoc.save()
    downloadBytes(bytes, `${activeDocument.title.replace('.pdf', '')}-脱敏版.pdf`)
    addTask('脱敏 PDF 已生成', '成功')
  }

  const handleImport = async (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return
    setImportMessage(`正在导入 ${files.length} 个文件`)
    try {
      const imported = await Promise.all(files.map(async (file, index) => {
        const bytes = await file.arrayBuffer()
        return {
          id: Date.now() + index,
          title: file.name,
          meta: `页数解析中 · ${(file.size / 1024 / 1024).toFixed(1)} MB · 刚刚导入`,
          status: '待处理',
          bytes,
          url: URL.createObjectURL(file),
          sizeText: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
          pageCount: '页数解析中',
          source: 'local',
        }
      }))
      setDocumentList((current) => [...imported, ...current])
      setActiveDocumentId(imported[0].id)
      setLeftTab('outline')
      setRightTab('progress')
      setReaderResetKey((key) => key + 1)
      setImportMessage(`已导入 ${imported[0].title}`)
      localDb.putMany(localDb.stores.documents, imported.map((doc) => ({ ...doc, url: undefined })))
      const importTask = { id: imported[0].id + 99, name: '文档导入', target: imported[0].title, state: '成功', time: '刚刚' }
      setTasks((current) => [
        importTask,
        ...current,
      ])
      localDb.put(localDb.stores.tasks, importTask)
      imported.forEach((doc) => {
        parsePageCount(doc)
        parsePaperDocument(doc)
      })
    } catch (error) {
      setImportMessage(`导入失败 ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      event.target.value = ''
    }
  }

  const parsePageCount = async (doc) => {
    const timeout = new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error('页数解析超时')), 3000)
    })
    try {
      const pdf = await Promise.race([PDFDocument.load(doc.bytes.slice(0)), timeout])
      const pageCount = `${pdf.getPageCount()} 页`
      updateDocument(doc.id, {
        pageCount,
        meta: `${pageCount} · ${doc.sizeText} · 刚刚导入`,
      })
    } catch {
      updateDocument(doc.id, {
        pageCount: '页数解析失败',
        meta: `页数解析失败 · ${doc.sizeText} · 刚刚导入`,
      })
    }
  }

  const parsePaperDocument = async (doc) => {
    try {
      const [pages, nativeOutline] = await Promise.all([
        extractPdfPages(doc.bytes),
        extractNativeOutline(doc.bytes),
      ])
      const paperData = buildPaperData(pages, doc.title, nativeOutline)
      const pageCount = `${pages.length} 页`
      const nextDoc = {
        ...doc,
        paperData,
        pageCount,
        status: '已解析',
        meta: `${pageCount} · ${doc.sizeText} · 结构已解析`,
      }
      updateDocument(doc.id, {
        paperData,
        pageCount,
        status: '已解析',
        meta: nextDoc.meta,
      })
      localDb.put(localDb.stores.documents, { ...nextDoc, url: undefined })
      const task = { id: doc.id + 199, name: '论文结构解析', target: doc.title, state: '成功', time: makeTime() }
      setTasks((current) => [task, ...current])
      localDb.put(localDb.stores.tasks, task)
    } catch (error) {
      updateDocument(doc.id, {
        status: '解析失败',
        meta: `结构解析失败 · ${doc.sizeText} · ${error instanceof Error ? error.message : '未知错误'}`,
      })
      const task = { id: doc.id + 299, name: '论文结构解析', target: doc.title, state: '失败', time: makeTime() }
      setTasks((current) => [task, ...current])
      localDb.put(localDb.stores.tasks, task)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <FileText size={22} />
          </div>
          <div>
            <h1>本地 PDF 智能工作台</h1>
            <p><span className="section-label">{activeMode.label}</span> · {mode === 'paper' ? '论文阅读工作区' : mode === 'privacy' ? '隐私脱敏工作区' : 'PDF 工具库'}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <nav className="mode-switch" aria-label="模式切换">
            {modes.map((item) => {
              const Icon = item.icon
              return (
                <button
                  className={mode === item.id ? 'mode active' : 'mode'}
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="header-actions">
            <label className="native-import">
              <Upload size={16} />
              <input type="file" accept=".pdf,application/pdf" multiple onChange={handleImport} />
            </label>
            <button type="button" className="primary-action" onClick={exportCurrentResult}>
              <Download size={16} />
              导出结果
            </button>
            <span className="import-message">{importMessage}</span>
          </div>
        </div>
      </header>

      {mode === 'paper' ? (
        <PaperWorkspace
          documents={documentList}
          leftTab={leftTab}
          setLeftTab={setLeftTab}
          rightTab={rightTab}
          setRightTab={setRightTab}
          rightContent={rightContent}
          activeDocument={activeDocument}
          addTask={addTask}
          readerResetKey={readerResetKey}
          aiOutputs={aiOutputs}
          setAiOutputs={setAiOutputs}
          paperState={paperState}
          setPaperState={setPaperState}
        />
      ) : (
        <ToolWorkspace
          privacy={mode === 'privacy'}
          documents={documentList}
          activeDocumentId={activeDocumentId}
          setActiveDocumentId={setActiveDocumentId}
          tasks={tasks}
          addTask={addTask}
          searchResults={searchResults}
          activeDocument={activeDocument}
          redactionResults={redactionResults}
          setRedactionResults={setRedactionResults}
          setRedactionPlan={setRedactionPlan}
          extractText={extractText}
          exportRedactedPdf={exportRedactedPdf}
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          toolFiles={toolFiles}
          setToolFiles={setToolFiles}
          toolPageCards={toolPageCards}
          setToolPageCards={setToolPageCards}
          runToolWithFiles={runToolWithFiles}
          exportRecords={exportRecords}
        />
      )}
    </main>
  )
}

function ToolWorkspace({
  privacy,
  documents,
  activeDocumentId,
  setActiveDocumentId,
  tasks,
  addTask,
  searchResults,
  activeDocument,
  redactionResults,
  setRedactionResults,
  setRedactionPlan,
  extractText,
  exportRedactedPdf,
  activeTool,
  setActiveTool,
  toolFiles,
  setToolFiles,
  toolPageCards,
  setToolPageCards,
  runToolWithFiles,
  exportRecords,
}) {
  const runRedactionScan = async () => {
    addTask('隐私脱敏识别', '处理中')
    try {
      if (!activeDocument?.bytes) {
        setRedactionResults([{ type: '提示', value: '请先导入真实 PDF' }])
        addTask('隐私脱敏识别等待文档', '等待中')
        return
      }
      const pages = await extractPdfPages(activeDocument.bytes)
      const matches = findSensitiveMatches(pages)
      const plan = createPageLineRedactions(pages, matches)
      setRedactionPlan(plan)
      setRedactionResults(matches.length > 0
        ? matches.map((item) => ({ type: `${item.type} 第 ${item.page} 页`, value: item.value }))
        : [{ type: '结果', value: pages.some((page) => page.text.trim()) ? '未发现常见敏感信息' : '未提取到文字层，扫描件需要接入 OCR 后识别' }])
      addTask('隐私脱敏识别完成', '成功')
    } catch {
      setRedactionResults([{ type: '错误', value: '文本提取失败，扫描版 PDF 需要 OCR' }])
      setRedactionPlan([])
      addTask('隐私脱敏识别失败', '等待中')
    }
  }

  if (activeTool) {
    return (
        <ToolDetail
        key={activeTool.name}
        tool={activeTool}
        files={toolFiles}
        setFiles={setToolFiles}
        pageCards={toolPageCards}
        setPageCards={setToolPageCards}
        tools={toolGroups.flatMap((group) => group.tools)}
        onSwitchTool={(tool) => {
          setActiveTool(tool)
          setToolFiles([])
          setToolPageCards([])
        }}
        onBack={() => setActiveTool(null)}
        onRun={(filesForRun, options, pageCardsForRun) => runToolWithFiles(activeTool.name, filesForRun, options, pageCardsForRun)}
        searchResults={searchResults}
        tasks={tasks}
        exportRecords={exportRecords}
      />
    )
  }

  return (
    <section className="tool-layout">
      <aside className="document-rail">
        <div className="rail-heading">
          <span>文档库</span>
          <Search size={16} />
        </div>
        {documents.map((doc) => (
          <button
            className={activeDocumentId === doc.id ? 'doc-row active' : 'doc-row'}
            type="button"
            key={doc.id}
            onClick={() => setActiveDocumentId(doc.id)}
          >
            <FileText size={18} />
            <span>
              <strong>{doc.title}</strong>
              <small>{doc.meta}</small>
            </span>
            <em>{doc.status}</em>
          </button>
        ))}
        <TaskCenter tasks={tasks} compact />
      </aside>

      <section className="tool-main">
        {privacy && (
          <div className="privacy-strip">
            <div>
              <LockKeyhole size={22} />
              <span>
                <strong>脱敏模块已启用</strong>
                <small>系统只在当前模式下执行敏感信息识别</small>
              </span>
            </div>
            <button type="button" onClick={runRedactionScan}>开始识别</button>
          </div>
        )}

        <div className="tool-grid">
          {toolGroups.map((group) => (
            <section className="tool-section" key={group.title}>
              <h3>{group.title}</h3>
              <div className="tool-list">
                {group.tools.map((tool) => {
                  const Icon = tool.icon
                  return (
                    <button className="tool-item" type="button" key={tool.name} onClick={() => setActiveTool(tool)}>
                      <Icon size={20} />
                      <span>
                        <strong>{tool.name}</strong>
                        <small>{tool.desc}</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        {privacy && (
          <section className="redaction-panel">
            <h3>隐私脱敏能力</h3>
            <div className="redaction-list">
              {privacyTools.map((item) => {
                const Icon = item.icon
                return (
                  <div className="redaction-item" key={item.name}>
                    <Icon size={21} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.value}</small>
                    </span>
                  </div>
                )
              })}
            </div>
            <ResultPanel title="识别结果" items={redactionResults.map((item) => `${item.type} ${item.value}`)} />
            <button className="privacy-export" type="button" onClick={exportRedactedPdf}>
              生成脱敏 PDF
            </button>
          </section>
        )}
        {searchResults.length > 0 && <ResultPanel title="搜索结果" items={searchResults} />}
        <TaskCenter tasks={tasks} />
      </section>
    </section>
  )
}

function ToolDetail({ tool, files, setFiles, pageCards, setPageCards, tools, onSwitchTool, onBack, onRun, searchResults, tasks, exportRecords }) {
  const [runMessage, setRunMessage] = useState('等待上传文件')
  const [toolOptions, setToolOptions] = useState(getDefaultToolOptions(tool.name))
  const [cropBox, setCropBox] = useState(null)
  const [overlayBoxes, setOverlayBoxes] = useState([])
  const [activeOverlayBoxId, setActiveOverlayBoxId] = useState(null)
  const [highlightBoxes, setHighlightBoxes] = useState([])
  const [activeHighlightBoxId, setActiveHighlightBoxId] = useState(null)
  const [textBoxes, setTextBoxes] = useState([])
  const [activeTextBoxId, setActiveTextBoxId] = useState(null)
  const [watermark, setWatermark] = useState(null)
  const [draggedPageId, setDraggedPageId] = useState(null)

  const importToolFiles = async (selected) => {
    if (selected.length === 0) return
    const imported = await Promise.all(selected.map(async (file, index) => {
      const bytes = await file.arrayBuffer()
      let pageCount
      try {
        const pdf = await PDFDocument.load(bytes)
        pageCount = `${pdf.getPageCount()} 页`
      } catch {
        pageCount = '页数解析失败'
      }
      return {
        id: Date.now() + index,
        name: file.name,
        size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        pageCount,
        bytes,
      }
    }))
    const nextImported = tool.name === '合并 PDF' ? imported : imported.slice(0, 1)
    setFiles((current) => (tool.name === '合并 PDF' ? [...current, ...nextImported] : nextImported))
    setCropBox(null)
    setOverlayBoxes([])
    setActiveOverlayBoxId(null)
    setHighlightBoxes([])
    setActiveHighlightBoxId(null)
    setTextBoxes([])
    setActiveTextBoxId(null)
    setWatermark(null)
    const totalCount = tool.name === '合并 PDF' ? files.length + nextImported.length : nextImported.length
    setRunMessage(`已准备 ${totalCount} 个文件`)
    if (['拆分 PDF', '页面旋转', '页面排序', '页面删除'].includes(tool.name)) {
      const firstFile = nextImported[0]
      const count = Number.parseInt(firstFile.pageCount, 10) || 1
      setPageCards(Array.from({ length: count }, (_, index) => ({
        id: `${firstFile.id}-${index + 1}`,
        page: index + 1,
        selected: false,
        removed: false,
      })))
    }
  }

  const handleToolFiles = async (event) => {
    const selected = Array.from(event.target.files || [])
    await importToolFiles(selected)
    event.target.value = ''
  }

  const handleDropFiles = async (event) => {
    event.preventDefault()
    const selected = Array.from(event.dataTransfer.files || []).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    await importToolFiles(selected)
  }

  const moveFile = (index, direction) => {
    setFiles((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const removeFile = (id) => {
    setFiles((current) => current.filter((file) => file.id !== id))
  }

  const togglePageRemoved = (id) => {
    setPageCards((current) => current.map((page) => (page.id === id ? { ...page, removed: !page.removed } : page)))
  }

  const togglePageSelected = (id) => {
    setPageCards((current) => current.map((page) => (page.id === id ? { ...page, selected: !page.selected } : page)))
  }

  const movePageCard = (id, direction) => {
    setPageCards((current) => {
      const index = current.findIndex((page) => page.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const dropPageCard = (targetId) => {
    if (!draggedPageId || draggedPageId === targetId) return
    setPageCards((current) => {
      const sourceIndex = current.findIndex((page) => page.id === draggedPageId)
      const targetIndex = current.findIndex((page) => page.id === targetId)
      if (sourceIndex < 0 || targetIndex < 0) return current
      const next = [...current]
      const [item] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, item)
      return next
    })
    setDraggedPageId(null)
  }

  if (tool.name === '任务队列') return <TaskQueuePage tasks={tasks} tools={tools} activeTool={tool} onSwitchTool={onSwitchTool} onBack={onBack} />
  if (tool.name === '导出记录') return <ExportRecordPage records={exportRecords} tasks={tasks} tools={tools} activeTool={tool} onSwitchTool={onSwitchTool} onBack={onBack} />

  return (
    <section className="tool-detail">
      <div className="tool-shortcuts">
        {tools.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={tool.name === item.name ? 'active' : ''}
              type="button"
              key={item.name}
              onClick={() => {
                setRunMessage('等待上传文件')
                setToolOptions(getDefaultToolOptions(item.name))
                setCropBox(null)
                setOverlayBoxes([])
                setActiveOverlayBoxId(null)
                setHighlightBoxes([])
                setActiveHighlightBoxId(null)
                setTextBoxes([])
                setActiveTextBoxId(null)
                onSwitchTool(item)
              }}
            >
              <Icon size={28} />
              <span>{item.name.replace(' PDF', '')}</span>
            </button>
          )
        })}
      </div>

      <div className="tool-detail-head">
        <button type="button" onClick={onBack}>返回工具库</button>
        <div>
          <h2>{tool.name}</h2>
          <p>{tool.desc}</p>
        </div>
      </div>

      <div className="upload-box">
        <h3>选择、粘贴或拖拽文件到此处</h3>
        <label
          className="drop-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDropFiles}
        >
          <input type="file" accept=".pdf,application/pdf" multiple={tool.name === '合并 PDF'} onChange={handleToolFiles} />
          <Upload size={28} />
          <span>上传文件</span>
          <small>
            {files.length > 0
              ? `已上传 ${files.length} 个文件，可以在下方调整后生成`
              : tool.name === '合并 PDF'
                ? '可选择多个 PDF，上传后可以调整合并顺序'
                : '选择一个 PDF 后设置处理参数，重新上传会替换当前文件'}
          </small>
        </label>
      </div>

      {files.length > 0 && (
        <section className="tool-file-panel">
          <h3>已上传文件</h3>
          <div className="uploaded-list">
            {files.map((file, index) => (
              <article key={file.id}>
                <FileText size={26} />
                <span>
                  <strong>{file.name}</strong>
                  <small>{file.size} · {file.pageCount}</small>
                </span>
                <div>
                  <button type="button" onClick={() => moveFile(index, -1)}>上移</button>
                  <button type="button" onClick={() => moveFile(index, 1)}>下移</button>
                  <button type="button" onClick={() => removeFile(file.id)}>删除</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <ToolOptions toolName={tool.name} fileCount={files.length} options={toolOptions} setOptions={setToolOptions} />

      {tool.name === '页面裁剪' && files[0] && (
        <CropBoxEditor
          file={files[0]}
          targetPage={toolOptions.targetPage}
          cropBox={cropBox}
          onCropBoxChange={setCropBox}
        />
      )}

      {tool.name === '遮盖块' && files[0] && (
        <OverlayBoxEditor
          file={files[0]}
          targetPage={toolOptions.targetPage}
          boxes={overlayBoxes}
          activeBoxId={activeOverlayBoxId}
          onBoxesChange={setOverlayBoxes}
          onActiveBoxChange={setActiveOverlayBoxId}
        />
      )}

      {tool.name === '高亮批注' && files[0] && (
        <TextHighlightEditor
          file={files[0]}
          targetPage={toolOptions.targetPage}
          highlights={highlightBoxes}
          activeHighlightId={activeHighlightBoxId}
          onHighlightsChange={setHighlightBoxes}
          onActiveHighlightChange={setActiveHighlightBoxId}
        />
      )}

      {tool.name === '文本框' && files[0] && (
        <TextBoxEditor
          file={files[0]}
          targetPage={toolOptions.targetPage}
          textBoxes={textBoxes}
          activeTextBoxId={activeTextBoxId}
          onTextBoxesChange={setTextBoxes}
          onActiveTextBoxChange={setActiveTextBoxId}
        />
      )}

      {tool.name === '水印签名' && files[0] && (
        <WatermarkEditor
          file={files[0]}
          targetPage={toolOptions.targetPage}
          watermark={watermark}
          onWatermarkChange={setWatermark}
        />
      )}

      {['拆分 PDF', '页面旋转', '页面排序', '页面删除'].includes(tool.name) && pageCards.length > 0 && (
        <section className="page-card-panel">
          <h3>{tool.name === '页面排序' ? '重新排列 PDF 页面' : tool.name === '页面删除' ? '选择要删除的页面' : '选择页面'}</h3>
          <div className="page-card-grid">
            {pageCards.map((page) => (
              <article
                className={`${page.removed ? 'removed' : ''} ${page.selected ? 'selected' : ''}`}
                key={page.id}
                draggable={tool.name === '页面排序'}
                onDragStart={() => setDraggedPageId(page.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropPageCard(page.id)}
              >
                <button type="button" className="page-preview-mini" onClick={() => togglePageSelected(page.id)}>
                  <span>{page.page}</span>
                </button>
                <strong>第{page.page}页</strong>
                <div className="page-card-actions">
                  {tool.name !== '页面删除' && tool.name !== '页面排序' && (
                    <button type="button" onClick={() => togglePageSelected(page.id)}>
                      {page.selected ? '取消选择' : '选择'}
                    </button>
                  )}
                  {(tool.name === '页面删除' || tool.name === '页面排序') && (
                    <button type="button" onClick={() => togglePageRemoved(page.id)}>
                      {page.removed ? '恢复' : '删除'}
                    </button>
                  )}
                  {tool.name === '页面排序' && (
                    <>
                      <button type="button" onClick={() => movePageCard(page.id, -1)}>上移</button>
                      <button type="button" onClick={() => movePageCard(page.id, 1)}>下移</button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
          <p>{tool.name === '页面排序' ? '提示：可以拖动页卡改变顺序，也可以用上移和下移微调。' : tool.name === '页面删除' ? '提示：点删除标记要移除的页面，生成时会保留未标记页面。' : '提示：未选择页面时，系统会使用上方页码范围设置。'}</p>
        </section>
      )}

      <div className="generate-row">
        <button
          type="button"
          disabled={files.length === 0}
          onClick={async () => {
            setRunMessage('正在生成 PDF')
            try {
              await onRun(files, { ...toolOptions, cropBox, overlayBoxes, highlightBoxes, textBoxes, watermark }, pageCards)
              setRunMessage('生成任务已执行，请查看下载结果或任务中心')
            } catch (error) {
              setRunMessage(error instanceof Error ? `生成失败 ${error.message}` : '生成失败，请检查设置')
            }
          }}
        >
          {tool.name === 'PDF 转 Word' ? '生成 Word' : tool.name === '文档搜索' ? '开始搜索' : '生成 PDF'}
        </button>
        <span>{runMessage}</span>
      </div>
      {tool.name === '文档搜索' && searchResults.length > 0 && (
        <ResultPanel title="搜索结果" items={searchResults} />
      )}
    </section>
  )
}

function ToolShortcutBar({ tools, activeTool, onSwitchTool }) {
  return (
    <div className="tool-shortcuts">
      {tools.map((item) => {
        const Icon = item.icon
        return (
          <button
            className={activeTool.name === item.name ? 'active' : ''}
            type="button"
            key={item.name}
            onClick={() => onSwitchTool(item)}
          >
            <Icon size={28} />
            <span>{item.name.replace(' PDF', '')}</span>
          </button>
        )
      })}
    </div>
  )
}

function ToolPageHead({ title, desc, onBack }) {
  return (
    <div className="tool-detail-head">
      <button type="button" onClick={onBack}>返回工具库</button>
      <div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
    </div>
  )
}

function TaskQueuePage({ tasks, tools, activeTool, onSwitchTool, onBack }) {
  return (
    <section className="tool-detail">
      <ToolShortcutBar tools={tools} activeTool={activeTool} onSwitchTool={onSwitchTool} />
      <ToolPageHead title="任务队列" desc="查看等待、处理中、成功和失败的 PDF 任务" onBack={onBack} />
      <section className="status-page-panel">
        <div className="status-summary">
          <span>全部任务 {tasks.length}</span>
          <span>成功 {tasks.filter((task) => task.state === '成功').length}</span>
          <span>处理中 {tasks.filter((task) => task.state === '处理中').length}</span>
          <span>等待中 {tasks.filter((task) => task.state === '等待中').length}</span>
        </div>
        <TaskCenter tasks={tasks} />
      </section>
    </section>
  )
}

function ExportRecordPage({ records, tasks, tools, activeTool, onSwitchTool, onBack }) {
  const [previewRecord, setPreviewRecord] = useState(null)
  const exportItems = records.length > 0
    ? records
    : tasks
      .filter((task) => task.state === '成功' || task.name.includes('导出') || task.name.includes('完成'))
      .map((task) => ({ ...task, type: '任务', name: task.name, target: task.target }))
  const previewUrl = useMemo(() => (
    previewRecord?.blob ? URL.createObjectURL(previewRecord.blob) : ''
  ), [previewRecord])

  useEffect(() => {
    if (!previewUrl) return undefined
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const downloadRecord = (record) => {
    if (!record?.blob) return
    downloadBlob(record.blob, record.name)
  }

  return (
    <section className="tool-detail">
      <ToolShortcutBar tools={tools} activeTool={activeTool} onSwitchTool={onSwitchTool} />
      <ToolPageHead title="导出记录" desc="查看已经生成过的 PDF、Word 和脱敏版本记录" onBack={onBack} />
      <section className="status-page-panel">
        {exportItems.length === 0 ? (
          <p className="empty-tip">还没有导出记录，完成任意工具任务后会出现在这里。</p>
        ) : (
          <div className="record-grid">
            {exportItems.map((record) => (
              <article key={record.id}>
                <Archive size={24} />
                <span>
                  <strong>{record.name}</strong>
                  <small>{record.target} · {record.type} · {record.time} · {record.state}{record.size ? ` · ${(record.size / 1024 / 1024).toFixed(2)} MB` : ''}</small>
                </span>
                <button type="button" onClick={() => setPreviewRecord(record)}>
                  查看
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
      {previewRecord && (
        <div className="export-preview-modal" role="dialog" aria-modal="true">
          <section className="export-preview-panel">
            <div className="export-preview-head">
              <div>
                <h3>{previewRecord.name}</h3>
                <p>{previewRecord.target} · {previewRecord.type} · {previewRecord.time}</p>
              </div>
              <div>
                <button type="button" disabled={!previewRecord.blob} onClick={() => downloadRecord(previewRecord)}>下载</button>
                <button type="button" onClick={() => setPreviewRecord(null)}>关闭</button>
              </div>
            </div>
            {previewRecord.type === 'PDF' && previewUrl ? (
              <iframe className="export-preview-frame" src={previewUrl} title={previewRecord.name} />
            ) : (
              <div className="export-preview-empty">
                <Archive size={34} />
                <strong>{previewRecord.blob ? `${previewRecord.type} 文件已保存在数据库记录中` : '这条旧记录没有保存结果文件'}</strong>
                <p>{previewRecord.blob ? '当前文件类型不适合直接嵌入预览，可以点击下载打开。' : '请重新生成一次，之后的新记录会保存文件并支持预览。'}</p>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  )
}

function ToolOptions({ toolName, fileCount, options, setOptions }) {
  if (toolName === '合并 PDF') {
    return (
      <section className="tool-options">
        <h3>合并设置</h3>
        <label>
          <input type="radio" name="merge-mode" checked={!options.addPageNumbers} onChange={() => setOptions((current) => ({ ...current, addPageNumbers: false }))} />
          按上方列表顺序合并
        </label>
        <label>
          <input type="radio" name="merge-mode" checked={options.addPageNumbers} onChange={() => setOptions((current) => ({ ...current, addPageNumbers: true }))} />
          合并后自动添加页码
        </label>
        <p>当前待合并文件数 {fileCount}</p>
      </section>
    )
  }

  if (toolName === '拆分 PDF') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <label>
          <input type="radio" name="split-mode" checked={options.mode === 'single'} onChange={() => setOptions((current) => ({ ...current, mode: 'single' }))} />
          一页一个文件并打包下载
        </label>
        <label>
          <input type="radio" name="split-mode" checked={options.mode === 'range'} onChange={() => setOptions((current) => ({ ...current, mode: 'range' }))} />
          指定页码范围
        </label>
        {options.mode === 'range' && (
          <div className="range-controls">
            <span>来自</span>
            <input value={options.fromPage} onChange={(event) => setOptions((current) => ({ ...current, fromPage: event.target.value }))} />
            <span>前往</span>
            <input value={options.toPage} onChange={(event) => setOptions((current) => ({ ...current, toPage: event.target.value }))} />
          </div>
        )}
        <p>当前待处理文件数 {fileCount}</p>
      </section>
    )
  }

  if (toolName === '页面旋转') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <label>
          <input type="radio" name="rotate-pages" checked={options.mode === 'range'} onChange={() => setOptions((current) => ({ ...current, mode: 'range' }))} />
          指定页码范围
        </label>
        <label>
          <input type="radio" name="rotate-pages" checked={options.mode === 'all'} onChange={() => setOptions((current) => ({ ...current, mode: 'all' }))} />
          全部页面
        </label>
        {options.mode === 'range' && (
          <div className="range-controls">
            <span>来自</span>
            <input value={options.fromPage} onChange={(event) => setOptions((current) => ({ ...current, fromPage: event.target.value }))} />
            <span>前往</span>
            <input value={options.toPage} onChange={(event) => setOptions((current) => ({ ...current, toPage: event.target.value }))} />
          </div>
        )}
        <div className="range-controls">
          <span>方向</span>
          <select value={options.rotateDirection} onChange={(event) => setOptions((current) => ({ ...current, rotateDirection: event.target.value }))}>
            <option value="right">向右 90 度</option>
            <option value="left">向左 90 度</option>
            <option value="upside">倒置 180 度</option>
          </select>
        </div>
        <p>当前待处理文件数 {fileCount}</p>
      </section>
    )
  }

  const simpleOptions = {
    页面裁剪: ['裁剪四周边距', '应用到指定页'],
    遮盖块: ['遮盖指定页区域', '保存不可逆版本'],
    高亮批注: ['高亮指定页区域', '添加批注说明', '导出批注版'],
  }

  if (toolName === '页面删除') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <p>上传后在页卡区域标记要删除的页面，生成时会导出保留页组成的新 PDF。</p>
      </section>
    )
  }

  if (toolName === '页面排序') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <p>上传后拖动页卡或点击上移下移调整顺序，生成时会按当前页卡顺序导出。</p>
      </section>
    )
  }

  if (toolName === '文本框') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <div className="range-controls">
          <span>页码</span>
          <input value={options.targetPage} onChange={(event) => setOptions((current) => ({ ...current, targetPage: event.target.value }))} />
        </div>
        <p>上传后在预览区新增文本框，点击文本框后可以修改内容、字号、颜色、字体、样式和位置。</p>
      </section>
    )
  }

  if (toolName === '水印签名') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <div className="range-controls">
          <span>预览页码</span>
          <input value={options.targetPage} onChange={(event) => setOptions((current) => ({ ...current, targetPage: event.target.value }))} />
        </div>
        <p>上传后可以预览平铺水印，也可以切换成单个签名并拖动位置。</p>
      </section>
    )
  }

  if (toolName === '文档搜索') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <div className="range-controls wide">
          <span>关键词</span>
          <input value={options.searchKeyword} onChange={(event) => setOptions((current) => ({ ...current, searchKeyword: event.target.value }))} />
        </div>
        <p>搜索结果会显示在工具库结果面板。</p>
      </section>
    )
  }

  if (toolName === 'PDF 转 Word') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <label>
          <input type="radio" name="word-mode" defaultChecked />
          提取文本并导出
        </label>
        <p>系统会提取 PDF 文本并生成基础 docx 文档。</p>
      </section>
    )
  }

  if (toolName === '页面裁剪') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <div className="range-controls">
          <span>页码</span>
          <input value={options.targetPage} onChange={(event) => setOptions((current) => ({ ...current, targetPage: event.target.value }))} />
        </div>
        <p>上传后在预览区拖动裁剪框，暗区会被裁掉，亮区会保留。</p>
      </section>
    )
  }

  if (toolName === '遮盖块') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <div className="range-controls">
          <span>页码</span>
          <input value={options.targetPage} onChange={(event) => setOptions((current) => ({ ...current, targetPage: event.target.value }))} />
        </div>
        <p>上传后在预览区新增遮盖块，点击遮盖块后可以拖动位置或拉伸大小。</p>
      </section>
    )
  }

  if (toolName === '高亮批注') {
    return (
      <section className="tool-options">
        <h3>处理设置</h3>
        <div className="range-controls">
          <span>页码</span>
          <input value={options.targetPage} onChange={(event) => setOptions((current) => ({ ...current, targetPage: event.target.value }))} />
        </div>
        <p>上传后在预览区新增高亮批注，点击批注后可以拖动、拉伸、调颜色和透明度。</p>
      </section>
    )
  }

  return (
    <section className="tool-options">
      <h3>处理设置</h3>
      {(simpleOptions[toolName] || ['按当前设置执行']).map((option, index) => (
        <label key={option}>
          <input type="radio" name={`${toolName}-mode`} defaultChecked={index === 0} />
          {option}
        </label>
      ))}
      <p>当前待处理文件数 {fileCount}</p>
    </section>
  )
}

function PaperWorkspace({ documents, leftTab, setLeftTab, rightTab, setRightTab, rightContent, activeDocument, addTask, readerResetKey, aiOutputs, setAiOutputs, paperState, setPaperState }) {
  const [leftWidth, setLeftWidth] = useState(270)
  const [rightWidth, setRightWidth] = useState(390)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const dragRef = useRef(null)

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current) return
      if (dragRef.current.side === 'left') {
        setLeftCollapsed(false)
        setLeftWidth(Math.max(220, Math.min(420, event.clientX - 18)))
      }
      if (dragRef.current.side === 'right') {
        setRightCollapsed(false)
        const nextWidth = window.innerWidth - event.clientX - 18
        setRightWidth(Math.max(300, Math.min(520, nextWidth)))
      }
    }

    const handleUp = () => {
      dragRef.current = null
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [])

  const addAnnotation = () => {
    setPaperState((current) => ({
      ...current,
      comments: [`第 ${current.currentPage} 页标注`, ...current.comments],
      bookmarks: current.bookmarks.includes(`第 ${current.currentPage} 页`)
        ? current.bookmarks
        : [`第 ${current.currentPage} 页`, ...current.bookmarks],
    }))
    addTask('添加批注', '成功')
  }

  return (
    <section
      className={`paper-layout ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}
      style={{
        gridTemplateColumns: `${leftCollapsed ? 20 : leftWidth}px 10px minmax(420px, 1fr) 10px ${rightCollapsed ? 20 : rightWidth}px`,
      }}
    >
      <aside className="left-sidebar">
        <button type="button" className="sidebar-collapse left" onClick={() => setLeftCollapsed((current) => !current)}>
          {leftCollapsed ? '>' : '<'}
        </button>
        <div className="sidebar-tabs compact">
          {leftTabs.map((tab) => {
            const Icon = tab.icon
            return (
              <IconButton key={tab.id} active={leftTab === tab.id} onClick={() => setLeftTab(tab.id)}>
                <Icon size={16} />
                <span>{tab.label}</span>
              </IconButton>
            )
          })}
        </div>
        {!leftCollapsed && <LeftPanel active={leftTab} activeDocument={activeDocument} paperState={paperState} setPaperState={setPaperState} setRightTab={setRightTab} />}
      </aside>
      <div
        className="sidebar-resizer"
        onMouseDown={() => {
          dragRef.current = { side: 'left' }
        }}
      />

      <section className="pdf-stage">
        <div className="reader-toolbar">
          <div>
            <BookMarked size={17} />
            <span>{activeDocument?.title || '未选择文档'}</span>
          </div>
          <div className="toolbar-actions">
            <button type="button">{activeDocument?.source === 'local' ? '100%' : '82%'}</button>
            <button type="button">第 {paperState.currentPage} 页</button>
            <button type="button" onClick={addAnnotation}>
              <Edit3 size={15} />
              标注
            </button>
          </div>
        </div>
        <div className="pdf-scroll-area">
          <PdfPreview activeDocument={activeDocument} readerResetKey={readerResetKey} paperState={paperState} setPaperState={setPaperState} />
        </div>
      </section>
      <div
        className="sidebar-resizer"
        onMouseDown={() => {
          dragRef.current = { side: 'right' }
        }}
      />

      <aside className="right-sidebar">
        <button type="button" className="sidebar-collapse right" onClick={() => setRightCollapsed((current) => !current)}>
          {rightCollapsed ? '<' : '>'}
        </button>
        <div className="sidebar-tabs">
          {rightTabs.map((tab) => {
            const Icon = tab.icon
            return (
              <IconButton key={tab.id} active={rightTab === tab.id} onClick={() => setRightTab(tab.id)}>
                <Icon size={15} />
                <span>{tab.label}</span>
              </IconButton>
            )
          })}
        </div>
        {!rightCollapsed && (
          <section className="assistant-panel">
            <div className="assistant-title">
              <PanelRight size={18} />
              <h3>{rightContent.title}</h3>
            </div>
            <SmartPanel tab={rightTab} content={rightContent} addTask={addTask} activeDocument={activeDocument} aiOutputs={aiOutputs} setAiOutputs={setAiOutputs} paperState={paperState} setPaperState={setPaperState} documents={documents} />
          </section>
        )}
      </aside>
    </section>
  )
}

function PdfPreview({ activeDocument, readerResetKey, paperState, setPaperState }) {
  return <ContinuousPdfPreview activeDocument={activeDocument} readerResetKey={readerResetKey} paperState={paperState} setPaperState={setPaperState} />
}

function ContinuousPdfPreview({ activeDocument, readerResetKey, paperState, setPaperState }) {
  const scrollRef = useRef(null)
  const pageRefs = useRef(new Map())
  const loadingTaskRef = useRef(null)
  const scrollTargetRef = useRef(null)
  const [pdfDocument, setPdfDocument] = useState(null)
  const [pageTotal, setPageTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [scale, setScale] = useState(1.2)
  const activeDocumentBytes = activeDocument?.bytes
  const activeDocumentId = activeDocument?.id

  useEffect(() => {
    let cancelled = false
    const loadPdf = async () => {
      if (!activeDocumentBytes) {
        setPdfDocument(null)
        setPageTotal(0)
        setStatus('请导入真实 PDF，当前显示的是演示页面')
        return
      }
      try {
        setStatus('正在载入 PDF')
        loadingTaskRef.current?.destroy?.()
        loadingTaskRef.current = pdfjsLib.getDocument({
          data: cloneBytesForPdfJs(activeDocumentBytes),
          isEvalSupported: false,
          useWorkerFetch: false,
        })
        const pdf = await withTimeout(loadingTaskRef.current.promise, 30000, 'PDF 读取超时')
        if (cancelled) return
        pageRefs.current.clear()
        setPdfDocument(pdf)
        setPageTotal(pdf.numPages)
        setStatus(`连续阅读 · 共 ${pdf.numPages} 页`)
      } catch (error) {
        if (!cancelled) setStatus(`PDF 载入失败 ${error instanceof Error ? error.message : '未知错误'}`)
      }
    }
    loadPdf()
    return () => {
      cancelled = true
      setPdfDocument(null)
      loadingTaskRef.current?.destroy?.()
    }
  }, [activeDocumentBytes, activeDocumentId, readerResetKey])

  useEffect(() => {
    if (!scrollRef.current || !pageTotal || !paperState.navigationTarget) return
    const targetPage = Math.max(1, Math.min(pageTotal, paperState.navigationTarget.page || 1))
    const targetY = paperState.navigationTarget.y || null
    const targetKey = `${paperState.navigationTarget.id || ''}-${targetPage}-${targetY || 0}`
    if (scrollTargetRef.current === targetKey) return
    const target = pageRefs.current.get(targetPage)
    if (!target) return
    scrollTargetRef.current = targetKey
    if (targetY && scrollRef.current) {
      const pageBox = target.querySelector('.pdf-js-page')
      const pageHeight = pageBox?.getBoundingClientRect().height || target.getBoundingClientRect().height
      const rawOffset = Math.max(0, pageHeight - targetY * scale - 28)
      scrollRef.current.scrollTo({
        top: target.offsetTop + rawOffset,
        behavior: 'auto',
      })
    } else {
      target.scrollIntoView({ block: 'start' })
    }
    window.setTimeout(() => {
      scrollTargetRef.current = null
      setPaperState((current) => (
        current.navigationTarget?.id === paperState.navigationTarget?.id
          ? { ...current, navigationTarget: null }
          : current
      ))
    }, 250)
  }, [pageTotal, paperState.navigationTarget, scale, setPaperState])

  const updateVisiblePage = () => {
    if (!scrollRef.current || scrollTargetRef.current) return
    const containerTop = scrollRef.current.getBoundingClientRect().top
    let nextPage = paperState.currentPage
    let bestDistance = Number.POSITIVE_INFINITY
    pageRefs.current.forEach((element, pageNumber) => {
      const distance = Math.abs(element.getBoundingClientRect().top - containerTop - 12)
      if (distance < bestDistance) {
        bestDistance = distance
        nextPage = pageNumber
      }
    })
    if (nextPage !== paperState.currentPage) {
      setPaperState((current) => ({ ...current, currentPage: nextPage, scrollToY: null }))
    }
  }

  const clearSelection = (event) => {
    if (event.target.closest('.reader-text-layer')) {
      event.target.closest('.reader-text-layer')?.classList.add('selecting')
      return
    }
    window.getSelection()?.removeAllRanges()
    setPaperState((current) => ({
      ...current,
      selectedText: '',
      selectionPage: null,
      translationMode: current.translationMode === 'selection' ? 'section' : current.translationMode,
    }))
  }

  const captureSelection = (pageNumber, textLayerElement) => {
    textLayerElement?.classList.remove('selecting')
    const selection = window.getSelection()
    const selectedText = selection?.toString() || ''
    const selectedTextNormalized = normalizeLine(selectedText)
    if (!selectedTextNormalized) {
      setPaperState((current) => ({
        ...current,
        selectedText: '',
        selectionPage: null,
        translationMode: current.translationMode === 'selection' ? 'section' : current.translationMode,
      }))
      return
    }
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    if (!range || !textLayerElement?.contains(range.commonAncestorContainer)) return
    setPaperState((current) => ({
      ...current,
      selectedText: selectedTextNormalized,
      selectionPage: pageNumber,
      currentPage: pageNumber,
      translationMode: 'selection',
    }))
  }

  const saveSelection = () => {
    if (!paperState.selectedText) return
    setPaperState((current) => ({
      ...current,
      cards: [
        {
          title: `第 ${current.selectionPage || current.currentPage} 页摘录`,
          desc: current.selectedText.slice(0, 160),
          page: current.selectionPage || current.currentPage,
        },
        ...(current.cards || []),
      ].slice(0, 20),
    }))
  }

  if (!activeDocument?.bytes) {
    return (
      <article className="pdf-page">
        <div className="paper-title">Adaptive Retrieval for Scientific Reading</div>
        <p className="paper-authors">Lin Chen · Maya Singh · Wei Zhao</p>
        <div className="abstract-block">
          <strong>Abstract</strong>
          <p>
            This paper presents a reading workbench that adapts retrieval and summarization to the current section
            of a scientific document.
          </p>
        </div>
        <h3>3 Method</h3>
        <p>
          导入真实 PDF 后，这里会使用 PDF.js 连续渲染整篇文档，并支持目录滚动定位。
        </p>
        <div className="figure-placeholder">
          <span>{status}</span>
        </div>
      </article>
    )
  }

  return (
    <div className="pdf-canvas-wrap">
      <div ref={scrollRef} className="pdf-continuous-scroll" onScroll={updateVisiblePage}>
        {pdfDocument && Array.from({ length: pageTotal }, (_, index) => index + 1).map((pageNumber) => (
          <PdfPageView
            key={`${activeDocumentId}-${pageNumber}-${scale}`}
            pdfDocument={pdfDocument}
            pageNumber={pageNumber}
            scale={scale}
            setPaperState={setPaperState}
            setPageRef={(element) => {
              if (element) pageRefs.current.set(pageNumber, element)
              else pageRefs.current.delete(pageNumber)
            }}
            onMouseDown={clearSelection}
            onSelection={(textLayerElement) => captureSelection(pageNumber, textLayerElement)}
          />
        ))}
      </div>
    </div>
  )
}

function PdfPageView({ pdfDocument, pageNumber, scale, setPaperState, setPageRef, onMouseDown, onSelection }) {
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)
  const renderTaskRef = useRef(null)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [status, setStatus] = useState('正在渲染')

  useEffect(() => {
    let cancelled = false
    const renderPage = async () => {
      if (!pdfDocument || !canvasRef.current || !textLayerRef.current) return
      try {
        renderTaskRef.current?.cancel?.()
        const page = await pdfDocument.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const outputScale = window.devicePixelRatio || 1
        const canvas = canvasRef.current
        const context = canvas.getContext('2d', { alpha: false })
        canvas.width = Math.round(viewport.width * outputScale)
        canvas.height = Math.round(viewport.height * outputScale)
        canvas.style.width = `${Math.round(viewport.width)}px`
        canvas.style.height = `${Math.round(viewport.height)}px`
        setPageSize({ width: Math.round(viewport.width), height: Math.round(viewport.height) })
        textLayerRef.current.innerHTML = ''
        textLayerRef.current.style.width = `${Math.round(viewport.width)}px`
        textLayerRef.current.style.height = `${Math.round(viewport.height)}px`
        textLayerRef.current.style.setProperty('--scale-factor', String(viewport.scale))
        textLayerRef.current.style.setProperty('--total-scale-factor', String(viewport.scale))
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        renderTaskRef.current = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        })
        await withTimeout(renderTaskRef.current.promise, 15000, '页面渲染超时')
        if (cancelled) return
        const textContent = await page.getTextContent()
        if (cancelled || !textLayerRef.current) return
        const pageText = normalizeLine(textContent.items.map((item) => item.str).join(' '))
        setPaperState((current) => (
          current.currentPage === pageNumber
            ? { ...current, currentPageText: pageText, currentPageTextPage: pageNumber }
            : current
        ))
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerRef.current,
          viewport,
        })
        await textLayer.render()
        if (!cancelled) setStatus('')
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : '渲染失败')
      }
    }
    renderPage()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel?.()
    }
  }, [pdfDocument, pageNumber, scale, setPaperState])

  return (
    <section
      ref={setPageRef}
      className="pdf-page-view"
      data-page-number={pageNumber}
      style={{ width: pageSize.width || undefined }}
      onMouseDown={onMouseDown}
      onMouseUp={() => onSelection(textLayerRef.current)}
    >
      <div className="pdf-js-page" style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}>
        {status && <span className="pdf-page-status">{status}</span>}
        <canvas ref={canvasRef} className="pdf-page-canvas" />
        <div ref={textLayerRef} className="textLayer reader-text-layer" />
      </div>
    </section>
  )
}

function SmartPanel({ tab, content, addTask, activeDocument, aiOutputs, setAiOutputs, paperState, setPaperState, documents = [] }) {
  const isLocal = activeDocument?.source === 'local'
  const paperData = activeDocument?.paperData
  const currentSection = getCurrentSection(paperData, paperState.currentPage)
  const parsedText = paperData
    ? `当前文件 ${paperData.title} 已解析。当前定位到 ${currentSection?.title || '正文'}。`
    : isLocal
      ? `当前文件 ${activeDocument.title} 已导入，正在等待结构解析完成。`
      : content.body
  const pendingText = isLocal
    ? parsedText
    : content.body
  const [savedRecommendations, setSavedRecommendations] = useState([])
  const [savedTerms, setSavedTerms] = useState([])
  const [questionList, setQuestionList] = useState(questions)
  const [savedCards, setSavedCards] = useState([])

  if (tab === 'translate') {
    const translationMode = paperState.translationMode || 'section'
    const currentPageText = paperState.currentPageTextPage === paperState.currentPage ? paperState.currentPageText : ''
    const wholePaperText = paperData
      ? [
        paperData.title,
        paperData.abstract,
        ...(paperData.sections || []).map((section) => section.text),
      ].filter(Boolean).join('\n')
      : currentPageText || content.body
    const originalTextMap = {
      section: currentSection?.text || currentPageText || paperData?.abstract || '',
      selection: paperState.selectedText || '',
      full: wholePaperText,
    }
    const sourceText = originalTextMap[translationMode] || originalTextMap.section || content.body
    const outputKey = `translate-${activeDocument?.id || 'demo'}-${translationMode}-${translationMode === 'selection' ? paperState.selectionPage || paperState.currentPage : currentSection?.title || 'full'}`
    const generated = aiOutputs[outputKey]
    const switchTranslationMode = (nextMode) => {
      setPaperState((current) => ({ ...current, translationMode: nextMode }))
    }
    return (
      <>
        <p>{pendingText}</p>
        <div className="segmented">
          <button className={translationMode === 'section' ? 'active' : ''} type="button" onClick={() => switchTranslationMode('section')}>当前章节</button>
          <button className={translationMode === 'selection' ? 'active' : ''} type="button" disabled={!paperState.selectedText} onClick={() => switchTranslationMode('selection')}>
            {paperState.selectedText ? `选中文本 ${paperState.selectionPage || paperState.currentPage} 页` : '选中文本'}
          </button>
          <button className={translationMode === 'full' ? 'active' : ''} type="button" onClick={() => switchTranslationMode('full')}>整篇论文</button>
        </div>
        <div className="translation-view">
          <div>
            <strong>原版</strong>
            <p>{cleanPdfExtractedText(sourceText).slice(0, 1200) || (translationMode === 'selection' ? '请先在左侧 PDF 页面中选择文字。' : '正在等待 PDF 文本解析结果。')}</p>
          </div>
          <div>
            <strong>译文</strong>
            <p>{generated || (isLocal ? '点击生成后，当前范围的本地规则译文会显示在这里。' : '文档会先被解析为结构化单元，随后助手生成与当前范围相关的翻译内容。')}</p>
          </div>
        </div>
        <button
          className="wide-action primary"
          type="button"
          onClick={() => {
            addTask(isLocal ? '生成当前译文' : '导出当前译文', '成功')
            const translated = makeLocalTranslation(sourceText || content.body, paperData?.title || activeDocument?.title)
            setAiOutputs((current) => ({
              ...current,
              [outputKey]: translated,
            }))
          }}
        >
          {isLocal ? '生成当前译文' : '导出当前译文'}
        </button>
      </>
    )
  }

  if (tab === 'summary') {
    const outputKey = `summary-${activeDocument?.id || 'demo'}-${currentSection?.title || paperState.currentPage}`
    const generated = aiOutputs[outputKey] || aiOutputs.summary
    const dynamicSummary = paperData ? makeLocalSummary(currentSection, paperData) : null
    return (
      <>
        <p>{pendingText}</p>
        <div className="summary-stack">
          {generated && (
            <section>
              <h4>生成结果</h4>
              <p>{generated}</p>
            </section>
          )}
          {dynamicSummary ? (
            <>
              <section>
                <h4>主要内容</h4>
                <p>{dynamicSummary.main}</p>
              </section>
              <section>
                <h4>关键概念</h4>
                <p>{dynamicSummary.concepts}</p>
              </section>
              <section>
                <h4>方法</h4>
                <p>{dynamicSummary.method}</p>
              </section>
              <section>
                <h4>实验结果</h4>
                <p>{dynamicSummary.experiment}</p>
              </section>
              <section>
                <h4>结论</h4>
                <p>{dynamicSummary.conclusion}</p>
              </section>
            </>
          ) : summaryBlocks.map((block) => (
            <section key={block.label}>
              <h4>{block.label}</h4>
              <p>{block.text}</p>
            </section>
          ))}
        </div>
        <button
          className="wide-action primary"
          type="button"
          onClick={() => {
            addTask('章节总结', '成功')
            const nextSummary = makeLocalSummary(currentSection, paperData)
            const summaryText = [
              `主要内容 ${nextSummary.main}`,
              `关键概念 ${nextSummary.concepts}`,
              `方法 ${nextSummary.method}`,
              `实验结果 ${nextSummary.experiment}`,
              `结论 ${nextSummary.conclusion}`,
            ].join('\n')
            setAiOutputs((current) => ({
              ...current,
              [outputKey]: summaryText,
              summary: summaryText,
            }))
          }}
        >
          {isLocal ? '生成章节总结' : '重新生成总结'}
        </button>
      </>
    )
  }

  if (tab === 'notes') {
    const currentCards = paperState.cards || []
    return (
      <>
        <p>{pendingText}</p>
        {paperState.selectedText && (
          <div className="selected-quote">
            <strong>当前选中文本</strong>
            <p>{paperState.selectedText}</p>
            <button
              type="button"
              onClick={() => {
                setPaperState((current) => ({
                  ...current,
                  notes: `${current.notes}\n第 ${current.selectionPage || current.currentPage} 页摘录 ${current.selectedText}`.trim(),
                }))
                addTask('保存摘录到笔记', '成功')
              }}
            >
              写入笔记
            </button>
          </div>
        )}
        <textarea
          className="note-editor"
          value={paperState.notes}
          onChange={(event) => setPaperState((current) => ({ ...current, notes: event.target.value }))}
        />
        <button
          className="wide-action"
          type="button"
          onClick={() => {
            setPaperState((current) => ({
              ...current,
              comments: [`第 ${current.currentPage} 页笔记已保存`, ...current.comments],
            }))
            addTask('保存阅读笔记', '成功')
          }}
        >
          保存当前页笔记
        </button>
        <div className="feature-list">
          {[...currentCards, ...notes].map((note) => (
            <button type="button" className="feature-row" key={`${note.title}-${note.page || ''}`}>
              <em>笔记</em>
              <span>
                <strong>{note.title}</strong>
                <small>{note.text}</small>
              </span>
            </button>
          ))}
        </div>
      </>
    )
  }

  if (tab === 'recommend') {
    const recommendationItems = paperData ? makeRecommendations(paperData) : recommendations
    return (
      <>
        <p>{pendingText}</p>
        <div className="recommend-list">
          {recommendationItems.map((item) => (
            <button type="button" key={item.title} onClick={() => setSavedRecommendations((current) => current.includes(item.title) ? current : [...current, item.title])}>
              <span>
                <strong>{item.title}</strong>
                <small>{item.type}</small>
              </span>
              <em>{savedRecommendations.includes(item.title) ? '已加入' : item.score}</em>
            </button>
          ))}
        </div>
        <button className="wide-action" type="button" onClick={() => {
          setSavedRecommendations(recommendationItems.map((item) => item.title))
          addTask('加入待读列表', '成功')
        }}>加入待读列表</button>
      </>
    )
  }

  if (tab === 'knowledge') {
    const termItems = paperData?.terms?.length ? paperData.terms : terms
    return (
      <>
        <p>{pendingText}</p>
        <div className="term-list">
          {termItems.map((item) => (
            <section key={item.term}>
              <h4>{item.term}</h4>
              <p>{item.desc}</p>
              <button type="button" onClick={() => {
                setSavedTerms((current) => current.includes(item.term) ? current : [...current, item.term])
                addTask('加入术语表', '成功')
              }}>{savedTerms.includes(item.term) ? '已加入术语表' : '加入术语表'}</button>
            </section>
          ))}
        </div>
      </>
    )
  }

  if (tab === 'progress') {
    const totalPages = Number.parseInt(activeDocument?.pageCount, 10) || paperData?.pageTexts?.length || 28
    const readPages = Math.min(totalPages, Math.max(paperState.currentPage, paperState.readPages?.length || 0))
    const percent = Math.round((readPages / Math.max(1, totalPages)) * 100)
    const chapterItems = paperData?.sections?.slice(0, 8).map((section) => {
      const done = paperState.currentPage > section.endPage
      const active = paperState.currentPage >= section.page && paperState.currentPage <= section.endPage
      return {
        name: section.title,
        state: done ? '已读完' : active ? '正在阅读' : '待阅读',
        percent: done ? 100 : active ? 55 : 8,
      }
    }) || chapterProgress
    return (
      <>
        <p>{pendingText}</p>
        <div className="progress-card">
          <div className="progress-head">
            <span>整体进度</span>
            <strong>{percent}%</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="progress-meta">
            <span>{totalPages} 页中已读 {readPages} 页</span>
            <span>上次位置已保存</span>
          </div>
        </div>
        <div className="chapter-list">
          {chapterItems.map((chapter) => (
            <div className="chapter-progress" key={chapter.name}>
              <div>
                <strong>{chapter.name}</strong>
                <small>{chapter.state}</small>
              </div>
              <div className="mini-track">
                <span style={{ width: `${chapter.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
      </>
    )
  }

  if (tab === 'figures') {
    return (
      <>
        <p>{content.body}</p>
        <div className="feature-list">
          {paperState.figures.map((item) => (
            <button type="button" className="feature-row" key={item.title}>
              <em>{item.type}</em>
              <span>
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </span>
            </button>
          ))}
        </div>
        <button
          className="wide-action"
          type="button"
          onClick={() => {
            setPaperState((current) => ({
              ...current,
              figures: [
                { type: '图表', title: `第 ${current.currentPage} 页新图表笔记`, meta: `第 ${current.currentPage} 页 · 已保存` },
                ...current.figures,
              ],
            }))
            addTask('保存图表公式笔记', '成功')
          }}
        >
          保存当前页图表公式
        </button>
      </>
    )
  }

  if (tab === 'questions') {
    return (
      <>
        <p>{content.body}</p>
        <div className="feature-list">
          {questionList.map((item) => (
            <button
              type="button"
              className="question-row"
              key={item.text}
              onClick={() => setQuestionList((current) => current.map((question) => (
                question.text === item.text
                  ? { ...question, state: question.state === '已解决' ? '未解决' : '已解决' }
                  : question
              )))}
            >
              <span>{item.text}</span>
              <em className={item.state === '已解决' ? 'resolved' : ''}>{item.state}</em>
            </button>
          ))}
        </div>
        <button className="wide-action" type="button" onClick={() => {
          setQuestionList((current) => [
            ...current,
            { text: `第 ${current.length + 1} 个当前页问题需要复查`, state: '未解决' },
          ])
          addTask('新增阅读问题', '成功')
        }}>
          新增当前页问题
        </button>
      </>
    )
  }

  if (tab === 'report') {
    const report = aiOutputs.report
    const reportText = paperData ? makeReadingReport(paperData, paperState, aiOutputs) : report
    return (
      <>
        <p>{content.body}</p>
        <div className="report-grid">
          {reportSections.map((section) => (
            <span key={section}>
              <CheckCircle2 size={15} />
              {section}
            </span>
          ))}
        </div>
        {reportText && <pre className="report-preview">{reportText}</pre>}
        <button
          className="wide-action primary"
          type="button"
          onClick={() => {
            addTask('生成阅读报告', '成功')
            setAiOutputs((current) => ({
              ...current,
              report: makeReadingReport(paperData, paperState, current),
            }))
          }}
        >
          生成阅读报告
        </button>
      </>
    )
  }

  if (tab === 'cards' || tab === 'references' || tab === 'library' || tab === 'compare') {
    if (tab === 'cards') {
      return (
        <>
          <p>{content.body}</p>
          <div className="card-stack">
            {cards.map((card) => (
              <article key={card.title}>
                <strong>{card.title}</strong>
                <p>{card.desc}</p>
                <button type="button" onClick={() => {
                  setSavedCards((current) => current.includes(card.title) ? current : [...current, card.title])
                  addTask('加入复习卡片', '成功')
                }}>{savedCards.includes(card.title) ? '已加入复习' : '加入复习'}</button>
              </article>
            ))}
          </div>
        </>
      )
    }

    if (tab === 'compare') {
      const rows = comparePaperDocuments(documents)
      return (
        <>
          <p>{content.body}</p>
          <div className="compare-table">
            {rows.map((row) => (
              <div key={row.field}>
                <strong>{row.field}</strong>
                <span>{row.current}</span>
                <span>{row.other}</span>
              </div>
            ))}
          </div>
        </>
      )
    }

    if (tab === 'library') {
      const knowledgeItems = buildKnowledgeItems(documents, paperState)
      const keyword = paperState.libraryKeyword.toLowerCase().trim()
      const libraryItems = knowledgeItems.filter((item) => (
        keyword === ''
        || item.title.toLowerCase().includes(keyword)
        || item.detail.toLowerCase().includes(keyword)
        || item.type.toLowerCase().includes(keyword)
      ))
      return (
        <>
          <p>{content.body}</p>
          <div className="knowledge-search">
            <Search size={16} />
            <input
              value={paperState.libraryKeyword}
              aria-label="知识库搜索"
              onChange={(event) => setPaperState((current) => ({ ...current, libraryKeyword: event.target.value }))}
            />
          </div>
          <div className="status-summary">
            <span>索引条目 {knowledgeItems.length}</span>
            <span>命中 {libraryItems.length}</span>
            <span>来源 {documents.filter((doc) => doc.paperData).length} 篇论文</span>
          </div>
          <div className="feature-list">
            {libraryItems.slice(0, 20).map((item) => (
              <button type="button" className="feature-row" key={`${item.type}-${item.title}`}>
                <em>知识</em>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.type} · {item.detail}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )
    }

    const referenceItems = paperData?.references?.length ? paperData.references : paperState.references
    return (
      <>
        <p>{content.body}</p>
        <div className="feature-list">
          {(tab === 'references' ? referenceItems.map((item) => item.title) : content.items).map((item) => (
            <button
              type="button"
              className="feature-row"
              key={item}
              onClick={() => {
                if (tab === 'references') {
                  setPaperState((current) => ({
                    ...current,
                    references: referenceItems.map((ref) => (ref.title === item ? { ...ref, saved: true } : ref)),
                  }))
                  addTask('加入待读引用', '成功')
                }
              }}
            >
              <em>{tab === 'references' ? '引用' : tab === 'cards' ? '卡片' : tab === 'compare' ? '对比' : '知识'}</em>
              <span>
                <strong>{item}</strong>
                <small>{tab === 'references' && referenceItems.find((ref) => ref.title === item)?.saved ? '已加入待读列表' : '点击查看详情并加入阅读记录'}</small>
              </span>
            </button>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <p>{content.body}</p>
      <div className="assistant-actions">
        {content.items.map((item) => (
          <button type="button" key={item}>
            {item}
          </button>
        ))}
      </div>
      <div className="ai-card">
        <Sparkles size={18} />
        <span>
          <strong>AI 服务层</strong>
          <small>当前保留接口层说明，没有 Key 时使用本地示例结果</small>
        </span>
      </div>
    </>
  )
}

function LeftPanel({ active, activeDocument, paperState, setPaperState, setRightTab }) {
  const isLocal = activeDocument?.source === 'local'
  const paperData = activeDocument?.paperData
  const documentOutline = isLocal ? (paperData?.outline || []) : outline
  if (active === 'outline') {
    if (isLocal) {
      return (
        <div className="left-panel">
          <h3>文档结构</h3>
          {documentOutline.length > 0 ? documentOutline.map((item) => (
            <button
              className="outline-row"
              style={{ '--outline-indent': `${Math.max(0, (item.level || 1) - 1) * 14}px` }}
              type="button"
              key={`${item.title}-${item.page}`}
              onClick={() => {
                setPaperState((current) => ({
                  ...current,
                  currentPage: item.page,
                  navigationTarget: { id: Date.now(), page: item.page, y: item.y || null },
                }))
                setRightTab(item.kind === 'title' ? 'summary' : 'translate')
              }}
            >
              <span className={paperState.currentPage >= item.page ? 'dot done' : 'dot'} />
              <strong>{item.title}</strong>
              <small>{item.page ? `第 ${item.page} 页` : activeDocument.pageCount || '待解析'}</small>
            </button>
          )) : (
            <button className="outline-row" type="button" onClick={() => setRightTab('summary')}>
              <span className="dot" />
              <strong>{activeDocument?.status === '解析失败' ? '结构解析失败' : '结构解析中'}</strong>
              <small>{activeDocument?.meta || '稍后生成'}</small>
            </button>
          )}
        </div>
      )
    }
    return (
      <div className="left-panel">
        <h3>论文大纲</h3>
        {outline.map((item) => (
          <button
            className="outline-row"
            style={{ '--outline-indent': `${Math.max(0, (item.level || 1) - 1) * 14}px` }}
            type="button"
            key={item.title}
            onClick={() => setPaperState((current) => ({
              ...current,
              currentPage: item.page,
              navigationTarget: { id: Date.now(), page: item.page, y: item.y || null },
            }))}
          >
            <span className={item.done ? 'dot done' : 'dot'} />
            <strong>{item.title}</strong>
            <small>第 {item.page} 页</small>
          </button>
        ))}
      </div>
    )
  }

  if (active === 'thumb') {
    return <ThumbnailPanel activeDocument={activeDocument} paperState={paperState} setPaperState={setPaperState} />
  }

  if (active === 'bookmark') {
    return (
      <div className="left-panel">
        <h3>书签</h3>
        <button
          className="wide-action"
          type="button"
          onClick={() => setPaperState((current) => ({
            ...current,
            bookmarks: [`第 ${current.currentPage} 页`, ...current.bookmarks.filter((item) => item !== `第 ${current.currentPage} 页`)],
          }))}
        >
          添加当前页书签
        </button>
        {paperState.bookmarks.map((item) => (
          <button className="simple-row" type="button" key={item} onClick={() => setRightTab('notes')}>
            <span>{item}</span>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    )
  }

  if (active === 'comment') {
    return (
      <div className="left-panel">
        <h3>注释</h3>
        <button
          className="wide-action"
          type="button"
          onClick={() => setPaperState((current) => ({
            ...current,
            comments: [`第 ${current.currentPage} 页注释`, ...current.comments],
          }))}
        >
          添加当前页注释
        </button>
        {paperState.comments.map((item) => (
          <button className="simple-row" type="button" key={item} onClick={() => setRightTab('notes')}>
            <span>{item}</span>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    )
  }

  if (active === 'search') {
    const keyword = paperState.searchKeyword.toLowerCase()
    const pageMatches = (paperData?.pageTexts || [])
      .filter((page) => page.text.toLowerCase().includes(keyword) || keyword.trim() === '')
      .slice(0, 10)
      .map((page) => ({
        title: `第 ${page.page} 页`,
        text: normalizeLine(page.text).slice(0, 90),
        page: page.page,
      }))
    const searchItems = keyword.trim()
      ? [
        ...documentOutline
          .filter((item) => item.title.toLowerCase().includes(keyword))
          .map((item) => ({ title: item.title, text: '章节标题', page: item.page })),
        ...pageMatches,
      ]
      : pageMatches
    return (
      <div className="left-panel">
        <h3>搜索替换</h3>
        <div className="knowledge-search">
          <Search size={16} />
          <input
            value={paperState.searchKeyword}
            aria-label="搜索论文内容"
            onChange={(event) => setPaperState((current) => ({ ...current, searchKeyword: event.target.value }))}
          />
        </div>
        {searchItems.map((item) => (
          <button
            className="simple-row"
            type="button"
            key={`${item.title}-${item.page}`}
            onClick={() => setPaperState((current) => ({
              ...current,
              currentPage: item.page,
              navigationTarget: { id: Date.now(), page: item.page, y: null },
            }))}
          >
            <span>
              <strong>{item.title}</strong>
              <small>{item.text}</small>
            </span>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="left-panel">
      <h3>{leftTabs.find((tab) => tab.id === active)?.label}</h3>
      <button className="simple-row" type="button">
        <span>当前面板可记录阅读状态</span>
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

function ThumbnailPanel({ activeDocument, paperState, setPaperState }) {
  const [thumbs, setThumbs] = useState([])
  const [status, setStatus] = useState('正在准备缩略图')
  const activeBytes = activeDocument?.bytes

  useEffect(() => {
    let cancelled = false
    const loadThumbs = async () => {
      if (!activeBytes) {
        setThumbs([])
        setStatus('演示文档使用页码占位缩略图')
        return
      }
      try {
        setStatus('正在渲染真实页面缩略图')
        const nextThumbs = await renderPdfThumbs(activeBytes, 12)
        if (cancelled) return
        setThumbs(nextThumbs)
        setStatus(`已生成 ${nextThumbs.length} 张缩略图`)
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? `缩略图生成失败 ${error.message}` : '缩略图生成失败')
      }
    }
    loadThumbs()
    return () => {
      cancelled = true
    }
  }, [activeBytes])

  const fallbackCount = Number.parseInt(activeDocument?.pageCount, 10) || activeDocument?.paperData?.pageTexts?.length || 8
  const items = thumbs.length > 0
    ? thumbs
    : Array.from({ length: Math.min(fallbackCount, 12) }, (_, index) => ({ page: index + 1 }))

  return (
    <div className="left-panel">
      <h3>页面缩略图</h3>
      <p className="panel-status">{status}</p>
      <div className="thumb-grid real-thumbs">
        {items.map((item) => (
          <button
            type="button"
            className={paperState.currentPage === item.page ? 'thumb active' : 'thumb'}
            key={item.page}
            onClick={() => setPaperState((current) => ({
              ...current,
              currentPage: item.page,
              navigationTarget: { id: Date.now(), page: item.page, y: null },
            }))}
          >
            {item.dataUrl ? <img src={item.dataUrl} alt={`第 ${item.page} 页缩略图`} /> : <span>{item.page}</span>}
            <small>{item.page}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

export default App

