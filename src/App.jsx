import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'
import JSZip from 'jszip'
import {
  Archive,
  BookOpen,
  Bookmark,
  Brain,
  CheckCircle2,
  ChevronRight,
  Columns3,
  Download,
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
  PanelRight,
  PenLine,
  Quote,
  RotateCw,
  Scissors,
  Search,
  Sparkles,
  SquareDashedMousePointer,
  Stamp,
  Tags,
  Upload,
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
  reportSections,
  rightPanelContent,
  summaryBlocks,
  terms,
} from './data/paperData'
import { createLeftTabs, createModes, createRightTabs, createToolGroups } from './data/toolConfig'
import { IconButton, ResultPanel, TaskCenter } from './components/common'
import { CropBoxEditor } from './components/tools/CropBoxEditor'
import { OverlayBoxEditor } from './components/tools/OverlayBoxEditor'
import { TextHighlightEditor } from './components/tools/TextHighlightEditor'
import { TextBoxEditor } from './components/tools/TextBoxEditor'
import { WatermarkEditor } from './components/tools/WatermarkEditor'
import { requestAi } from './services/aiClient'
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
  Sparkles,
  SquareDashedMousePointer,
  Stamp,
  Tags,
}

const modes = createModes(iconMap)
const toolGroups = createToolGroups(iconMap)
const leftTabs = [
  ...createLeftTabs(iconMap).slice(0, 3),
  { id: 'chat', label: 'AI 对话', icon: MessageSquareText },
  ...createLeftTabs(iconMap).slice(3),
]
const rightTabs = createRightTabs(iconMap)
const PAPER_PARSE_VERSION = 5

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

const cleanHeadingTitle = (line) => normalizeLine(line)
  .replace(/^[.\s·?]+/, '')
  .replace(/\s+/g, ' ')
  .trim()

const getHeadingLevel = (heading = '') => {
  const match = heading.match(/^(\d+(?:\.\d+){0,3})\.?\s+/)
  if (!match) return /abstract|references|bibliography/i.test(heading) ? 1 : 0
  return match[1].split('.').length
}

const normalizeHeadingKey = (heading = '') => cleanHeadingTitle(heading)
  .toLowerCase()
  .replace(/^\d+(?:\.\d+){0,3}\.?\s*/, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const hashText = (text = '') => {
  let hash = 0
  String(text).slice(0, 600).split('').forEach((char) => {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  })
  return Math.abs(hash).toString(36)
}

const wordHints = {
  uav: '无人机',
  remote: '远程的，遥感语境中常指遥感',
  image: '图像',
  images: '图像',
  small: '小型的，小目标语境中指尺寸较小',
  detecting: '检测，识别目标位置',
  detect: '检测',
  traditional: '传统的',
  lightweight: '轻量级的',
  method: '方法',
  methods: '方法',
  due: '由于，因为',
  difficulty: '困难',
  high: '高的',
  background: '背景',
  improve: '提升，改进',
  improves: '提升，改进',
  replacing: '替换',
  conv: '卷积',
  convolution: '卷积',
  retrain: '重新训练',
  fine: '精细的',
  grained: '细粒度的',
  module: '模块',
  better: '更好的',
  efficient: '高效的',
  efficiently: '高效地',
  structure: '结构',
  structures: '结构',
  parameter: '参数',
  parameters: '参数量',
  mean: '平均值',
  average: '平均的',
  dataset: '数据集',
  experiments: '实验',
  multi: '多',
  offers: '提供',
  effective: '有效的',
  reduction: '减少，降低',
  reduce: '减少，降低',
  reducing: '减少，降低',
  improvement: '提升，改进',
  challenging: '具有挑战性的',
  feature: '特征',
  extraction: '提取',
  interference: '干扰',
  computational: '计算相关的',
  complexity: '复杂度',
  replace: '替换',
  replacing: '替换',
  train: '训练',
  trained: '训练得到的',
  retain: '保留',
  refined: '精细化的',
  fusion: '融合',
  incorporate: '引入，整合',
  incorporates: '引入，整合',
  preserve: '保留',
  transfer: '传递，迁移',
  evaluation: '评估',
  compared: '相比，对比',
  baseline: '基线模型',
  additional: '额外的',
  demonstrate: '证明，展示',
  robustness: '鲁棒性',
  precision: '精确率',
  score: '分数，指标得分',
  solution: '解决方案',
  target: '目标',
  targets: '目标',
  sensing: '感知，遥感语境中指传感观测',
  recognition: '识别',
  robust: '鲁棒的，能抵抗环境变化的',
  modality: '模态，数据或传感器类型',
  modalities: '多种模态',
  embedded: '嵌入式的',
  pretraining: '预训练',
  beneficial: '有益的',
  accuracy: '准确率',
  robustness: '鲁棒性',
  architecture: '网络结构',
  backbone: '骨干网络',
  infrared: '红外的',
  detection: '检测',
  dataset: '数据集',
  datasets: '数据集',
  parameters: '参数量',
  performance: '性能表现',
  generalization: '泛化能力',
  distribution: '分布',
  out: '外部或超出',
  domain: '领域',
  tuning: '微调',
}

const normalizeLookupWord = (word = '') => {
  const normalized = word.toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (wordHints[normalized]) return normalized
  const candidates = [
    normalized.replace(/ies$/, 'y'),
    normalized.replace(/ves$/, 'f'),
    normalized.replace(/ing$/, ''),
    normalized.replace(/ing$/, 'e'),
    normalized.replace(/ed$/, ''),
    normalized.replace(/ed$/, 'e'),
    normalized.replace(/es$/, ''),
    normalized.replace(/s$/, ''),
  ].filter((item) => item && item.length >= 2)
  return candidates.find((item) => wordHints[item]) || normalized
}

const explainWord = (word = '') => {
  const normalized = normalizeLookupWord(word)
  if (!normalized) return ''
  const cleanWord = String(word).replace(/[^\w-]/g, '')
  if (wordHints[normalized]) return `${cleanWord} ${wordHints[normalized]}`
  return `${cleanWord} 需要结合当前段落确认`
}

const inferWordTip = (word, translatedText = '') => {
  const baseTip = explainWord(word)
  const normalized = normalizeLookupWord(word)
  const text = translatedText || ''
  const phraseHints = [
    { words: ['remote', 'sensing'], zh: '遥感' },
    { words: ['target', 'detection', 'detecting'], zh: '目标检测' },
    { words: ['feature', 'extraction'], zh: '特征提取' },
    { words: ['computational', 'complexity'], zh: '计算复杂度' },
    { words: ['background', 'interference'], zh: '背景干扰' },
    { words: ['fine', 'grained'], zh: '细粒度' },
    { words: ['parameter', 'parameters'], zh: '参数量' },
  ]
  const phrase = phraseHints.find((item) => item.words.includes(normalized) && text.includes(item.zh))
  return phrase ? `${String(word).replace(/[^\w-]/g, '')} ${phrase.zh}` : baseTip
}

const formatTranslationText = (text = '') => normalizeLine(text)
  .replace(/^本地规则译文。本文围绕[^。]*。?/, '')
  .replace(/^本地规则译文。本段来自[^。]*。?/, '')
  .replace(/当前版本未接入在线翻译引擎[^。]*。?$/g, '')
  .replace(/\s+/g, ' ')
  .replace(/([。！？])\s*/g, '$1\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const buildParagraphRegions = (textContent, viewport) => {
  const rawLines = textContent.items
    .filter((item) => item?.str?.trim() && Array.isArray(item.transform))
    .filter((item) => Math.abs(item.transform[0] || 0) >= Math.abs(item.transform[1] || 0))
    .map((item) => {
      const x = item.transform[4] || 0
      const y = item.transform[5] || 0
      const height = item.height || Math.abs(item.transform[3] || item.transform[0] || 10)
      const width = item.width || item.str.length * height * 0.45
      const leftTop = viewport.convertToViewportPoint(x, y + height)
      const leftBottom = viewport.convertToViewportPoint(x, y)
      return {
        text: item.str,
        x,
        y,
        left: leftBottom[0],
        top: leftTop[1],
        right: leftBottom[0] + width * viewport.scale,
        bottom: leftBottom[1],
        height: Math.max(8, height * viewport.scale),
      }
    })
  const lineGroups = []
  rawLines
    .sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x)
    .forEach((item) => {
      const line = lineGroups.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5)
      if (line) line.items.push(item)
      else lineGroups.push({ y: item.y, items: [item] })
    })
  const lines = lineGroups
    .flatMap((line) => {
      const sorted = line.items.sort((a, b) => a.x - b.x)
      const visualLines = []
      sorted.forEach((item) => {
        const previous = visualLines.at(-1)
        const previousItem = previous?.items.at(-1)
        const gap = previousItem ? item.left - previousItem.right : 0
        const averageHeight = Math.max(8, item.height || previousItem?.height || 10)
        if (!previous || gap > averageHeight * 7.5) {
          visualLines.push({ items: [item] })
        } else {
          previous.items.push(item)
        }
      })
      return visualLines.map((visualLine) => {
        const items = visualLine.items
        return {
          text: normalizeLine(items.map((item) => item.text).join('')),
          left: Math.min(...items.map((item) => item.left)),
          right: Math.max(...items.map((item) => item.right)),
          top: Math.min(...items.map((item) => item.top)),
          bottom: Math.max(...items.map((item) => item.bottom)),
          y: line.y,
        }
      })
    })
    .filter((line) => line.text.length > 2)
    .sort((a, b) => a.top - b.top || a.left - b.left)

  const columns = []
  lines.forEach((line) => {
    const column = columns.find((candidate) => {
      const overlap = Math.max(0, Math.min(candidate.right, line.right) - Math.max(candidate.left, line.left))
        / Math.max(1, Math.min(candidate.right - candidate.left, line.right - line.left))
      return Math.abs(candidate.left - line.left) < 95 || overlap > 0.58
    })
    if (column) {
      column.lines.push(line)
      column.left = Math.min(column.left, line.left)
      column.right = Math.max(column.right, line.right)
    } else {
      columns.push({ left: line.left, right: line.right, lines: [line] })
    }
  })

  const paragraphs = columns.flatMap((column) => {
    const columnParagraphs = []
    column.lines
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .forEach((line) => {
        const previous = columnParagraphs.at(-1)
        const lineHeight = Math.max(10, line.bottom - line.top)
        const verticalGap = previous ? line.top - previous.bottom : 0
        const captionLike = /^(figure|fig\.|table)\s*\d+/i.test(line.text)
        const overlap = previous
          ? Math.max(0, Math.min(previous.right, line.right) - Math.max(previous.left, line.left)) / Math.max(1, Math.min(previous.right - previous.left, line.right - line.left))
          : 1
        const startsIndentedParagraph = previous
          && /[.!?。！？]$/.test(previous.text.trim())
          && line.left - previous.left > 28
          && verticalGap < lineHeight * 1.4
        const hasLargeGap = previous && verticalGap > lineHeight * 1.65
        const hasColumnDrift = previous && overlap < 0.34
        const continuesVisualParagraph = previous && overlap >= 0.55 && verticalGap <= lineHeight * 1.45
        const shouldStart = !previous || captionLike || (!continuesVisualParagraph && (startsIndentedParagraph || hasLargeGap || hasColumnDrift))
        if (shouldStart) {
          columnParagraphs.push({
            id: `p-${columnParagraphs.length + 1}`,
            text: line.text,
            left: line.left,
            right: line.right,
            top: line.top,
            bottom: line.bottom,
          })
        } else {
          previous.text = normalizeLine(`${previous.text}${previous.text.endsWith('-') ? '' : ' '}${line.text}`)
          previous.left = Math.min(previous.left, line.left)
          previous.right = Math.max(previous.right, line.right)
          previous.top = Math.min(previous.top, line.top)
          previous.bottom = Math.max(previous.bottom, line.bottom)
        }
      })
    return columnParagraphs
  })
  const mergedParagraphs = []
  paragraphs
    .filter((item) => item.text.length > 18)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .forEach((item) => {
      const previous = mergedParagraphs.at(-1)
      const itemHeight = Math.max(12, item.bottom - item.top)
      const gap = previous ? item.top - previous.bottom : 0
      const overlap = previous
        ? Math.max(0, Math.min(previous.right, item.right) - Math.max(previous.left, item.left)) / Math.max(1, Math.min(previous.right - previous.left, item.right - item.left))
        : 0
      if (previous && gap <= itemHeight * 1.2 && overlap >= 0.45 && !/^(figure|fig\.|table)\s*\d+/i.test(item.text)) {
        previous.text = normalizeLine(`${previous.text}${previous.text.endsWith('-') ? '' : ' '}${item.text}`)
        previous.left = Math.min(previous.left, item.left)
        previous.right = Math.max(previous.right, item.right)
        previous.top = Math.min(previous.top, item.top)
        previous.bottom = Math.max(previous.bottom, item.bottom)
      } else {
        mergedParagraphs.push({ ...item })
      }
    })

  return mergedParagraphs
    .map((item) => ({
      ...item,
      left: Math.max(0, item.left - 4),
      top: Math.max(0, item.top - 3),
      width: Math.max(24, item.right - item.left + 8),
      height: Math.max(18, item.bottom - item.top + 6),
    }))
}

const splitReaderTextItems = (textContent) => {
  const items = textContent.items.flatMap((item) => {
    if (!item?.str || item.str.length <= 1 || item.str.length > 180 || !Array.isArray(item.transform)) return [item]
    const chars = Array.from(item.str)
    const visibleCount = chars.filter((char) => char !== ' ').length || chars.length
    const spaceCount = chars.length - visibleCount
    if (visibleCount <= 1) return [item]
    const totalWidth = item.width || 0
    const transform = item.transform
    const baseX = transform[4] || 0
    const baseY = transform[5] || 0
    const angleLength = Math.hypot(transform[0] || 0, transform[1] || 0) || 1
    const unitX = (transform[0] || angleLength) / angleLength
    const unitY = (transform[1] || 0) / angleLength
    const weightedCount = visibleCount + spaceCount * 0.42
    let advance = 0
    return chars.map((char) => {
      const ratio = char === ' ' ? 0.42 : 1
      const charWidth = totalWidth > 0 ? (totalWidth * ratio) / weightedCount : 0
      const nextItem = {
        ...item,
        str: char,
        width: charWidth,
        transform: [...transform],
      }
      nextItem.transform[4] = baseX + unitX * advance
      nextItem.transform[5] = baseY + unitY * advance
      advance += charWidth
      return nextItem
    })
  })
  return { ...textContent, items }
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
    ...(paperState.bookmarks || []).map((item) => {
      const bookmark = typeof item === 'string' ? { title: item } : item
      return { type: '书签', title: bookmark.title, detail: bookmark.page ? `第 ${bookmark.page} 页` : '阅读位置' }
    }),
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

const cleanReferenceUrl = (value = '') => value
  .replace(/[)\].,;]+$/g, '')
  .replace(/^doi:/i, '')

const makeReferenceLink = (reference = '') => {
  const text = normalizeLine(reference)
  const url = text.match(/https?:\/\/[^\s)]+/i)?.[0]
  if (url) return { href: cleanReferenceUrl(url), label: '网页链接' }

  const doi = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]
  if (doi) return { href: `https://doi.org/${cleanReferenceUrl(doi)}`, label: 'DOI 跳转' }

  const arxiv = text.match(/\barxiv[:\s]*([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i)?.[1]
  if (arxiv) return { href: `https://arxiv.org/abs/${arxiv}`, label: 'arXiv 跳转' }

  const query = text
    .replace(/^\[\d+\]\s*/, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/\bhttps?:\/\/\S+/ig, '')
    .slice(0, 240)
  return {
    href: `https://www.semanticscholar.org/search?q=${encodeURIComponent(query)}&sort=relevance`,
    label: '论文检索',
  }
}

const extractReferences = (pages) => {
  let startPageIndex = -1
  let startLineIndex = -1
  pages.forEach((page, pageIndex) => {
    const lines = page.lines || []
    lines.forEach((line, lineIndex) => {
      if (/^(references|bibliography)$/i.test(normalizeLine(line)) && pageIndex >= Math.floor(pages.length * 0.45)) {
        startPageIndex = pageIndex
        startLineIndex = lineIndex
      }
    })
  })
  if (startPageIndex < 0) return []

  const referenceLines = pages.slice(startPageIndex).flatMap((page, pageOffset) => {
    const lines = page.lines || []
    return pageOffset === 0 ? lines.slice(startLineIndex + 1) : lines
  })
  const referenceText = referenceLines.join('\n')
  const collectMatches = (pattern) => {
    const matches = []
    let match = pattern.exec(referenceText)
    while (match) {
      matches.push({
        id: Number(match[1]) || matches.length + 1,
        title: normalizeLine(match[2] || ''),
        link: makeReferenceLink(match[2] || ''),
        saved: false,
      })
      match = pattern.exec(referenceText)
    }
    return matches
  }
  const numbered = collectMatches(/\[(\d+)\]\s*([\s\S]*?)(?=\n?\s*\[\d+\]\s|$)/g)
  const dotted = numbered.length > 1 ? [] : collectMatches(/(?:^|\n)\s*(\d+)\.\s+([\s\S]*?)(?=\n\s*\d+\.\s+|$)/g)
  const candidates = numbered.length > 1 ? numbered : dotted
  const cleaned = candidates
    .map((item, index) => ({ ...item, id: item.id || index + 1 }))
    .filter((item) => item.title.length > 30 && item.title.length < 1200)
    .filter((item) => /(?:\b(19|20)\d{2}\b|arxiv|doi|Proceedings|Conference|Journal|IEEE|CVPR|ICCV|ECCV|NeurIPS|ICLR|AAAI|ACM|Springer|Elsevier|Transactions)/i.test(item.title))
    .filter((item) => !/^(figure|fig\.|table)\s*\d+/i.test(item.title))

  if (cleaned.length > 0) return cleaned
  return referenceLines
    .map(normalizeLine)
    .filter((line) => line.length > 40 && line.length < 500)
    .filter((line) => /(?:\b(19|20)\d{2}\b|arxiv|doi|Proceedings|Conference|Journal|IEEE|CVPR|ICCV|ECCV|NeurIPS|ICLR|AAAI)/i.test(line))
    .filter((line) => !/^(figure|fig\.|table)\s*\d+/i.test(line))
    .map((title, index) => ({
      id: index + 1,
      title,
      link: makeReferenceLink(title),
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

const findHeadingLineOnPage = (pages, item) => {
  const targetKey = normalizeHeadingKey(item.title)
  if (!targetKey) return null
  const page = pages.find((candidate) => candidate.page === item.page)
  if (!page) return null
  const lines = page.lineObjects || []
  return lines.find((line) => normalizeHeadingKey(line.text) === targetKey)
    || lines.find((line) => {
      const lineKey = normalizeHeadingKey(line.text)
      return lineKey && (lineKey.includes(targetKey) || targetKey.includes(lineKey))
    })
    || null
}

const alignOutlineToPageText = (pages, outlineItems = []) => outlineItems.map((item) => {
  const matchedLine = findHeadingLineOnPage(pages, item)
  if (!matchedLine) return item
  return {
    ...item,
    title: cleanHeadingTitle(item.title),
    y: matchedLine.y,
    x: matchedLine.x,
    matchedText: matchedLine.text,
  }
})

const median = (values = []) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const stopTermWords = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'to', 'with', 'by', 'from', 'as', 'at',
  'this', 'that', 'these', 'those', 'we', 'our', 'their', 'it', 'its', 'they', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'table', 'figure', 'fig', 'section', 'appendix', 'page', 'paper',
  'proceedings', 'ieee', 'cvf', 'conference', 'journal', 'press', 'copyright',
])

const termKnowledge = {
  ImageNet: '大规模图像预训练数据集。这里用于判断预训练对超小模型是否仍有帮助。',
  ConvNets: '卷积神经网络。本文讨论超小 ConvNets 在红外目标检测中的鲁棒性。',
  EfficientNet: '高效卷积网络系列。常作为小模型或边缘端模型的对比基线。',
  LLVIP: '低光可见光和红外配对数据集。可用于低照度目标检测和跨模态研究。',
  FLIR: '红外图像数据集。常用于热成像目标检测和自动驾驶场景评估。',
  OOD: '分布外泛化。表示测试场景与训练分布不一致时模型的稳定性。',
  RGB: '可见光图像模态。本文会与红外图像模态进行跨域对比。',
  mAP: '平均精度均值。目标检测任务中常用的性能指标。',
  Robustness: '鲁棒性。表示模型在噪声、跨域或环境变化下保持性能的能力。',
  Pretraining: '预训练。先在大规模数据上学习通用特征，再迁移到目标任务。',
  'Object Detection': '目标检测。定位并识别图像中的目标类别。',
  'Infrared Object Detection': '红外目标检测。利用热红外图像识别行人、车辆等目标。',
  'Ultra Small ConvNets': '超小卷积网络。参数量很小，适合边缘设备，但泛化能力更容易受限。',
  'Cross Domain Detection': '跨域检测。训练域和测试域不同，重点考察模型迁移能力。',
}

const shouldKeepTerm = (term, text) => {
  const clean = term.trim()
  const lower = clean.toLowerCase()
  if (clean.length < 3 || clean.length > 48) return false
  if (stopTermWords.has(lower)) return false
  if (/^\d+$/.test(clean)) return false
  if (/^(The|For|Table|Figure|In Proceedings of)$/i.test(clean)) return false
  if (termKnowledge[clean]) return true
  const contextPattern = /(model|network|dataset|detection|infrared|pretrain|robust|domain|benchmark|metric|convnet|imagenet|thermal|object)/i
  return contextPattern.test(clean) || new RegExp(`${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.{0,80}${contextPattern.source}`, 'i').test(text)
}

const describeTerm = (term, count) => {
  if (termKnowledge[term]) return termKnowledge[term]
  if (/dataset|imagenet|llvip|flir/i.test(term)) return `${term} 是本文相关的数据集或数据来源，需要关注它在实验设置中的作用。`
  if (/model|network|convnet|efficientnet/i.test(term)) return `${term} 是模型或网络结构概念，重点看它的参数规模、精度和部署场景。`
  if (/detection|domain|robust|pretrain/i.test(term)) return `${term} 是本文的核心任务或评估维度，建议结合方法和实验结果理解。`
  return `${term} 在文中出现 ${count} 次，属于需要结合上下文理解的关键词。`
}

const extractTerms = (pages) => {
  const text = pages.map((page) => page.text).join(' ')
  const known = Object.keys(termKnowledge)
  const phraseCounts = new Map()
  const phraseRegex = /\b(?:[A-Z][A-Za-z0-9-]+|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z0-9-]+|and|Network|Detection|Dataset|Metric|Models?|ConvNets?)){0,3}\b/g
  ;[...text.matchAll(phraseRegex)].forEach((match) => {
    const term = cleanHeadingTitle(match[0])
    if (!shouldKeepTerm(term, text)) return
    phraseCounts.set(term, (phraseCounts.get(term) || 0) + 1)
  })
  known.forEach((term) => {
    if (new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
      phraseCounts.set(term, (phraseCounts.get(term) || 0) + 3)
    }
  })
  return Array.from(phraseCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term, count]) => ({
      term,
      count,
      desc: describeTerm(term, count),
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
  const nativeItems = alignOutlineToPageText(pages, nativeOutline)
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

const translateFigureAnalysis = (text = '') => {
  const clean = cleanPdfExtractedText(text)
  if (!clean) return ''
  const lower = clean.toLowerCase()
  if (/out-of-distribution|ood/.test(lower) && /imagenet/.test(lower)) {
    return '该图展示超小模型在分布外场景下的表现。作者强调 ImageNet 预训练并非对所有模型都稳定有效，主要只在前几个模型规模上带来帮助。'
  }
  if (/backbone params|mflops|detector params|complexity/.test(lower)) {
    return '该表对比不同模型的骨干网络参数量、计算量和检测器复杂度，用来说明模型规模变小时，计算开销和检测性能之间的权衡。'
  }
  if (/flir|llvip|dataset|resolution|images/.test(lower)) {
    return '这段说明实验数据集和输入设置，重点交代图像来源、分辨率、类别和训练测试划分。'
  }
  if (/pre-training|pretrain|training|sgd|epoch/.test(lower)) {
    return '这段说明预训练和训练细节，包括训练轮数、学习率、优化器和数据增强设置。'
  }
  return translateAcademicSentence(clean).slice(0, 180) || clean.slice(0, 180)
}

const extractContextAfterMatch = (text, matchIndex, maxLength = 520) => {
  if (matchIndex < 0) return ''
  const nextText = text.slice(matchIndex, matchIndex + maxLength)
  const sentences = splitSentences(nextText)
  return sentences.slice(0, 3).join(' ')
}

const inferFigureFormulaItems = (paperData, currentPage = 1) => {
  const page = paperData?.pageTexts?.find((item) => item.page === currentPage)
  const text = cleanPdfExtractedText(page?.text || '')
  if (!text) return []
  const section = getCurrentSection(paperData, currentPage)
  const items = []
  const pushItem = (type, title, detail, source = '') => {
    if (items.some((item) => item.title === title)) return
    items.push({
      type,
      title,
      meta: `第 ${currentPage} 页 · ${section?.title || '正文'} · ${detail}`,
      source: source || '',
      analysis: translateFigureAnalysis(source || text),
    })
  }

  const figureMatch = text.match(/\b(?:Figure|Fig\.?)\s*([0-9]+)\b/i)
  if (figureMatch) {
    pushItem(
      '图表',
      `图 ${figureMatch[1]} ${text.includes('OOD') ? '分布外性能曲线' : '当前页图像结果'}`,
      '根据图题线索识别',
      extractContextAfterMatch(text, figureMatch.index),
    )
  }

  const tableMatch = text.match(/\bTable\s*([0-9]+)\b/i)
  if (tableMatch || /Backbone Params|MFLOPs|Detector Params/i.test(text)) {
    const tableIndex = tableMatch?.index ?? Math.max(text.search(/Backbone Params/i), 0)
    pushItem(
      '表格',
      tableMatch ? `表 ${tableMatch[1]} 实验数据表` : '当前页模型参数表',
      '包含参数量或计算量信息',
      extractContextAfterMatch(text, tableIndex),
    )
  }

  const formulaMatch = text.match(/\(([0-9]{1,2})\)|=\s*[A-Za-z0-9_{}^\\+\-*/().\s]{8,}/)
  if (formulaMatch && !figureMatch) pushItem('公式', `公式 ${formulaMatch[1] || '当前页'} 推导项`, '根据编号或等式线索识别', extractContextAfterMatch(text, formulaMatch.index || 0))

  if (/mAP|accuracy|robustness|pre-training|pretraining/i.test(text)) {
    const metricIndex = text.search(/mAP|accuracy|robustness|pre-training|pretraining/i)
    pushItem('指标', '性能指标与实验结论', '关注 mAP、鲁棒性和预训练影响', extractContextAfterMatch(text, metricIndex))
  }

  return items.slice(0, 4)
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
  const [mode, setMode] = useState('normal')
  const [leftTab, setLeftTab] = useState('outline')
  const [rightTab, setRightTab] = useState('translate')
  const [documentList, setDocumentList] = useState(documents)
  const [activeDocumentId, setActiveDocumentId] = useState(documents[0].id)
  const [tasks, setTasks] = useState(initialTasks)
  const [importMessage, setImportMessage] = useState('请选择 PDF 文件')
  const [readerResetKey, setReaderResetKey] = useState(0)
  const [searchResults, setSearchResults] = useState([])
  const [redactionPlan, setRedactionPlan] = useState([])
  const [aiOutputs, setAiOutputs] = useState({})
  const [activeTool, setActiveTool] = useState(() => toolGroups[0]?.tools[0] || null)
  const [toolFiles, setToolFiles] = useState([])
  const [toolPageCards, setToolPageCards] = useState([])
  const [exportRecords, setExportRecords] = useState([])
  const [paperState, setPaperState] = useState({
    currentPage: 1,
    currentPageText: '',
    currentPageTextPage: null,
    activeParagraph: null,
    bookmarks: [],
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
    activeParagraph: paperState.activeParagraph,
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
    localDb.put(localDb.stores.exports, { ...record, blob: undefined, blobStored: Boolean(blob) })
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
        const selectedPages = resolveSelectedPages(pdfDoc.getPageCount(), { mode: 'all' }, pageCardsForRun)
        for (const pageIndex of selectedPages) {
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
            <p><span className="section-label">{activeMode.label}</span> · {mode === 'paper' ? '论文阅读工作区' : 'PDF 工具库'}</p>
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
          documents={documentList}
          activeDocumentId={activeDocumentId}
          setActiveDocumentId={setActiveDocumentId}
          tasks={tasks}
          addTask={addTask}
          searchResults={searchResults}
          activeDocument={activeDocument}
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
  documents,
  activeDocumentId,
  setActiveDocumentId,
  tasks,
  addTask,
  searchResults,
  activeTool,
  setActiveTool,
  toolFiles,
  setToolFiles,
  toolPageCards,
  setToolPageCards,
  runToolWithFiles,
  exportRecords,
}) {
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

  const setAllPagesSelected = (selected) => {
    setPageCards((current) => current.map((page) => ({ ...page, selected, removed: selected ? false : page.removed })))
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
          <div className="page-card-head">
            <h3>{tool.name === '页面排序' ? '重新排列 PDF 页面' : tool.name === '页面删除' ? '选择要删除的页面' : '选择页面'}</h3>
            {(tool.name === '拆分 PDF' || tool.name === '页面旋转') && (
              <div>
                <button type="button" onClick={() => setAllPagesSelected(true)}>全选</button>
                <button type="button" onClick={() => setAllPagesSelected(false)}>取消全选</button>
              </div>
            )}
          </div>
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
          <p>{tool.name === '页面排序' ? '提示：可以拖动页卡改变顺序，也可以用上移和下移微调。' : tool.name === '页面删除' ? '提示：点删除标记要移除的页面，生成时会保留未标记页面。' : '提示：选择页面后只处理选中的页；未选择页面时，系统会使用上方处理设置。'}</p>
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
          每页拆成单独 PDF，并打包成 ZIP 下载
        </label>
        <label>
          <input type="radio" name="split-mode" checked={options.mode === 'range'} onChange={() => setOptions((current) => ({ ...current, mode: 'range' }))} />
          把指定页码合成一个新 PDF
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
        <div className="pdf-scroll-area">
          <PdfPreview activeDocument={activeDocument} readerResetKey={readerResetKey} paperState={paperState} setPaperState={setPaperState} setRightTab={setRightTab} />
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

function PdfPreview({ activeDocument, readerResetKey, paperState, setPaperState, setRightTab }) {
  return <ContinuousPdfPreview activeDocument={activeDocument} readerResetKey={readerResetKey} paperState={paperState} setPaperState={setPaperState} setRightTab={setRightTab} />
}

function ContinuousPdfPreview({ activeDocument, readerResetKey, paperState, setPaperState, setRightTab }) {
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
      const pageData = activeDocument?.paperData?.pageTexts?.find((page) => page.page === targetPage)
      const pageMaxY = Math.max(...(pageData?.lineObjects || []).map((line) => line.y).filter(Boolean), targetY)
      const pageMinY = Math.min(...(pageData?.lineObjects || []).map((line) => line.y).filter(Boolean), 0)
      const normalizedY = pageMaxY > pageMinY ? (pageMaxY - targetY) / (pageMaxY - pageMinY) : 0
      const rawOffset = Math.max(0, normalizedY * pageHeight - 36)
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
  }, [activeDocument?.paperData?.pageTexts, pageTotal, paperState.navigationTarget, setPaperState])

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

  const chooseParagraph = (paragraph) => {
    window.getSelection()?.removeAllRanges()
    setPaperState((current) => ({
      ...current,
      currentPage: paragraph.page,
      selectedText: '',
      selectionPage: null,
      activeParagraph: paragraph,
      translationMode: 'paragraph',
    }))
    setRightTab?.('translate')
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
            bookmarks={paperState.bookmarks || []}
            activeParagraph={paperState.activeParagraph}
            setPaperState={setPaperState}
            setPageRef={(element) => {
              if (element) pageRefs.current.set(pageNumber, element)
              else pageRefs.current.delete(pageNumber)
            }}
            onMouseDown={clearSelection}
            onSelection={(textLayerElement) => captureSelection(pageNumber, textLayerElement)}
            onParagraphClick={chooseParagraph}
          />
        ))}
      </div>
    </div>
  )
}

function PdfPageView({ pdfDocument, pageNumber, scale, bookmarks, activeParagraph, setPaperState, setPageRef, onMouseDown, onSelection, onParagraphClick }) {
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)
  const renderTaskRef = useRef(null)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [status, setStatus] = useState('正在渲染')
  const [paragraphRegions, setParagraphRegions] = useState([])
  const pageBookmarks = (bookmarks || []).filter((item) => {
    const bookmark = typeof item === 'string' ? null : item
    return bookmark?.page === pageNumber
  })

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
        const textContent = await page.getTextContent({
          disableCombineTextItems: true,
          includeMarkedContent: true,
        })
        if (cancelled || !textLayerRef.current) return
        const nextParagraphRegions = buildParagraphRegions(textContent, viewport).map((item) => ({
          ...item,
          page: pageNumber,
          key: `${pageNumber}-${hashText(item.text)}-${Math.round(item.top)}-${Math.round(item.left)}`,
        }))
        setParagraphRegions(nextParagraphRegions)
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
        {pageBookmarks.length > 0 && (
          <span
            className="pdf-bookmark-marker"
            title={pageBookmarks.map((item) => item.title).join('，')}
            style={{ '--bookmark-color': pageBookmarks[0]?.color || '#35568a' }}
          >
            书签
          </span>
        )}
        <canvas ref={canvasRef} className="pdf-page-canvas" />
        <div ref={textLayerRef} className="textLayer reader-text-layer" />
        <div className="paragraph-hit-layer" aria-label="段落热区">
          {paragraphRegions.map((region) => (
            <button
              type="button"
              key={region.key}
              className={`paragraph-region ${activeParagraph?.key === region.key ? 'active' : ''}`}
              style={{
                left: region.left,
                top: region.top,
                width: region.width,
                height: region.height,
              }}
              title={region.text}
              onClick={(event) => {
                event.stopPropagation()
                onParagraphClick(region)
              }}
            />
          ))}
        </div>
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
  const [savedTerms, setSavedTerms] = useState([])
  const [questionList, setQuestionList] = useState(questions)
  const [savedCards, setSavedCards] = useState([])
  const [aiPending, setAiPending] = useState('')
  const [wordTranslations, setWordTranslations] = useState({})

  const requestWordTranslation = async (word, translatedText = '') => {
    const cleanWord = String(word || '').replace(/[^\w-]/g, '')
    if (!cleanWord || cleanWord.length < 2) return
    const key = `${cleanWord.toLowerCase()}-${hashText(paperState.activeParagraph?.text || translatedText || '')}`
    if (wordTranslations[key]?.status === 'done' || wordTranslations[key]?.status === 'loading') return
    const localTip = inferWordTip(cleanWord, translatedText)
    if (!localTip.includes('需要结合当前段落确认')) {
      setWordTranslations((current) => ({ ...current, [key]: { status: 'done', text: localTip } }))
      return
    }
    setWordTranslations((current) => ({ ...current, [key]: { status: 'loading', text: `${cleanWord} 翻译中` } }))
    try {
      const result = await requestAi({
        task: 'word',
        text: cleanWord,
        title: paperData?.title || activeDocument?.title,
        context: `只翻译这个英文词，输出格式为 词语 中文含义。当前段落 ${paperState.activeParagraph?.text || translatedText}`,
      })
      setWordTranslations((current) => ({
        ...current,
        [key]: { status: 'done', text: normalizeLine(result).slice(0, 80) || localTip },
      }))
    } catch {
      setWordTranslations((current) => ({ ...current, [key]: { status: 'done', text: localTip } }))
    }
  }

  const renderLookupText = (text, translatedText = '') => String(text || '').split(/(\s+)/).map((part, index) => {
    if (!/\w/.test(part)) return part
    const cleanWord = part.replace(/[^\w-]/g, '')
    const tipKey = `${cleanWord.toLowerCase()}-${hashText(paperState.activeParagraph?.text || translatedText || '')}`
    const tip = wordTranslations[tipKey]?.text || inferWordTip(part, translatedText)
    return (
      <span
        tabIndex={0}
        className="word-tooltip"
        data-tip={tip}
        key={`${part}-${index}`}
        onMouseEnter={() => requestWordTranslation(part, translatedText)}
        onFocus={() => requestWordTranslation(part, translatedText)}
      >
        {part}
      </span>
    )
  })
  const renderTranslationParagraphs = (text, fallbackText) => {
    const paragraphs = formatTranslationText(text || fallbackText)
    const fullTranslation = paragraphs.join(' ')
    return paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
      <p className="clickable-translation" key={`${paragraph.slice(0, 18)}-${index}`}>
        {renderLookupText(paragraph, fullTranslation)}
      </p>
    )) : (
      <p className="clickable-translation">{renderLookupText(fallbackText)}</p>
    )
  }

  const runAiTask = async ({ task, text, title, context, onSuccess, fallback }) => {
    setAiPending(task)
    try {
      const result = await requestAi({ task, text, title, context })
      onSuccess(result)
      addTask(task === 'translate' ? 'AI 翻译完成' : task === 'summary' ? 'AI 总结完成' : 'AI 阅读报告完成', '成功')
    } catch (error) {
      if (fallback) onSuccess(fallback())
      addTask(error instanceof Error ? error.message : 'AI 请求失败', '失败')
    } finally {
      setAiPending('')
    }
  }

  const activeParagraphText = paperState.activeParagraph?.text || ''
  const activeParagraphOutputKey = `translate-${activeDocument?.id || 'demo'}-paragraph-${paperState.activeParagraph?.key || hashText(activeParagraphText)}`
  useEffect(() => {
    if (tab !== 'translate' || paperState.translationMode !== 'paragraph' || !activeParagraphText || aiOutputs[activeParagraphOutputKey] || aiPending === 'translate') return
    runAiTask({
      task: 'translate',
      text: activeParagraphText,
      title: paperData?.title || activeDocument?.title,
      context: `自动翻译第 ${paperState.activeParagraph?.page || paperState.currentPage} 页段落`,
      fallback: () => makeLocalTranslation(activeParagraphText, paperData?.title || activeDocument?.title),
      onSuccess: (translated) => setAiOutputs((current) => ({
        ...current,
        [activeParagraphOutputKey]: translated,
      })),
    })
  }, [tab, paperState.translationMode, activeParagraphText, activeParagraphOutputKey])

  const figureInferredItems = inferFigureFormulaItems(paperData, paperState.currentPage)
  const figureOutputKey = `figure-${activeDocument?.id || 'demo'}-${paperState.currentPage}`
  const aiFigureText = aiOutputs[figureOutputKey]
  useEffect(() => {
    if (tab !== 'figures' || figureInferredItems.length === 0 || aiFigureText || aiPending === 'figure') return
    runAiTask({
      task: 'figure',
      text: figureInferredItems.map((item, index) => [
        `条目 ${index + 1}`,
        `类型 ${item.type}`,
        `标题 ${item.title}`,
        `原文 ${item.source || item.meta}`,
      ].join('\n')).join('\n\n'),
      title: paperData?.title || activeDocument?.title,
      context: `当前页 ${paperState.currentPage}，请解释这些图表公式和正文关系`,
      fallback: () => figureInferredItems.map((item) => `${item.title}\n图表含义 ${translateFigureAnalysis(item.source || item.meta)}\n关键结论 该条目需要结合当前页正文和图表位置判断。\n与正文关系 它服务于当前页的方法说明或实验论证。`).join('\n\n'),
      onSuccess: (result) => setAiOutputs((current) => ({
        ...current,
        [figureOutputKey]: result,
      })),
    })
  }, [tab, paperState.currentPage, figureOutputKey, figureInferredItems.length, aiFigureText])

  if (tab === 'translate') {
    const translationMode = paperState.translationMode || (paperState.activeParagraph ? 'paragraph' : 'section')
    const currentPageText = paperState.currentPageTextPage === paperState.currentPage ? paperState.currentPageText : ''
    const wholePaperText = paperData
      ? [
        paperData.title,
        paperData.abstract,
        ...(paperData.sections || []).map((section) => section.text),
      ].filter(Boolean).join('\n')
      : currentPageText || content.body
    const originalTextMap = {
      paragraph: paperState.activeParagraph?.text || '',
      section: currentSection?.text || currentPageText || paperData?.abstract || '',
      selection: paperState.selectedText || '',
      full: wholePaperText,
    }
    const sourceText = originalTextMap[translationMode] || originalTextMap.section || content.body
    const outputKey = `translate-${activeDocument?.id || 'demo'}-${translationMode}-${translationMode === 'paragraph' ? paperState.activeParagraph?.key || hashText(sourceText) : translationMode === 'selection' ? paperState.selectionPage || paperState.currentPage : currentSection?.title || 'full'}`
    const generated = aiOutputs[outputKey]
    const localGenerated = makeLocalTranslation(sourceText || content.body, paperData?.title || activeDocument?.title)
    const displayedTranslation = generated || (translationMode === 'paragraph' && sourceText ? localGenerated : '')
    const switchTranslationMode = (nextMode) => {
      setPaperState((current) => ({ ...current, translationMode: nextMode }))
    }
    return (
      <>
        <p>{pendingText}</p>
        <div className="segmented">
          <button className={translationMode === 'paragraph' ? 'active' : ''} type="button" disabled={!paperState.activeParagraph} onClick={() => switchTranslationMode('paragraph')}>
            {paperState.activeParagraph ? `当前段落 ${paperState.activeParagraph.page} 页` : '当前段落'}
          </button>
          <button className={translationMode === 'section' ? 'active' : ''} type="button" onClick={() => switchTranslationMode('section')}>当前章节</button>
          <button className={translationMode === 'full' ? 'active' : ''} type="button" onClick={() => switchTranslationMode('full')}>整篇论文</button>
        </div>
        <div className="translation-view">
          <div>
            <strong>原版</strong>
            {renderTranslationParagraphs(cleanPdfExtractedText(sourceText).slice(0, 1200), translationMode === 'paragraph' ? '请先点击左侧 PDF 中的一个段落。' : '正在等待 PDF 文本解析结果。')}
          </div>
          <div>
            <strong>译文</strong>
            {renderTranslationParagraphs(displayedTranslation, isLocal ? '点击左侧段落后，译文会自动显示在这里。' : '文档会先被解析为结构化单元，随后助手生成与当前范围相关的翻译内容。')}
          </div>
        </div>
        <button
          className="wide-action primary"
          type="button"
          disabled={aiPending === 'translate'}
          onClick={() => {
            runAiTask({
              task: 'translate',
              text: sourceText || content.body,
              title: paperData?.title || activeDocument?.title,
              context: `翻译范围 ${translationMode}`,
              fallback: () => makeLocalTranslation(sourceText || content.body, paperData?.title || activeDocument?.title),
              onSuccess: (translated) => setAiOutputs((current) => ({
                ...current,
                [outputKey]: translated,
              })),
            })
          }}
        >
          {aiPending === 'translate' ? 'AI 翻译中' : translationMode === 'paragraph' ? '重新生成段落译文' : isLocal ? '生成当前译文' : '导出当前译文'}
        </button>
      </>
    )
  }

  if (tab === 'summary') {
    const outputKey = `summary-${activeDocument?.id || 'demo'}-${currentSection?.title || paperState.currentPage}`
    const generated = aiOutputs[outputKey] || aiOutputs.summary
    const dynamicSummary = paperData ? makeLocalSummary(currentSection, paperData) : null
    const fallbackSections = dynamicSummary
      ? [
        { label: '主要内容', text: dynamicSummary.main },
        { label: '关键概念', text: dynamicSummary.concepts },
        { label: '方法', text: dynamicSummary.method },
        { label: '实验结果', text: dynamicSummary.experiment },
        { label: '结论', text: dynamicSummary.conclusion },
      ]
      : summaryBlocks
    return (
      <>
        <p>{pendingText}</p>
        <div className="summary-stack">
          {generated ? (
            <section>
              <h4>AI 章节总结</h4>
              <p>{generated}</p>
            </section>
          ) : (
            <section>
              <h4>本地预览摘要</h4>
              <p>点击下方按钮后会调用 AI 生成正式章节总结。当前内容是根据 PDF 文本规则提取的预览结果。</p>
            </section>
          )}
          {!generated && fallbackSections.map((block) => (
              <section key={block.label}>
                <h4>{block.label}</h4>
                <p>{block.text}</p>
              </section>
            ))}
        </div>
        <button
          className="wide-action primary"
          type="button"
          disabled={aiPending === 'summary'}
          onClick={() => {
            const nextSummary = makeLocalSummary(currentSection, paperData)
            const fallbackSummary = () => [
              `主要内容 ${nextSummary.main}`,
              `关键概念 ${nextSummary.concepts}`,
              `方法 ${nextSummary.method}`,
              `实验结果 ${nextSummary.experiment}`,
              `结论 ${nextSummary.conclusion}`,
            ].join('\n')
            runAiTask({
              task: 'summary',
              text: currentSection?.text || paperData?.abstract || content.body,
              title: paperData?.title || activeDocument?.title,
              context: `当前章节 ${currentSection?.title || paperState.currentPage}`,
              fallback: fallbackSummary,
              onSuccess: (summaryText) => setAiOutputs((current) => ({
                ...current,
                [outputKey]: summaryText,
                summary: summaryText,
              })),
            })
          }}
        >
          {aiPending === 'summary' ? 'AI 总结中' : isLocal ? '生成章节总结' : '重新生成总结'}
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
    const aiRecommendation = aiOutputs[`recommend-${activeDocument?.id || 'demo'}`]
    return (
      <>
        <p>AI 会根据当前论文题目、摘要和参考文献，生成可继续检索的研究方向、关键词和代码仓库方向。</p>
        {aiRecommendation ? (
          <section className="ai-output-card">
            <h4>AI 推荐结果</h4>
            <p>{aiRecommendation}</p>
          </section>
        ) : (
          <section className="ai-output-card muted">
            <h4>等待生成</h4>
            <p>点击下方按钮后，这里会显示结构化推荐结果。不再展示本地关键词拼接出来的临时条目。</p>
          </section>
        )}
        <button
          className="wide-action primary"
          type="button"
          disabled={aiPending === 'recommend'}
          onClick={() => {
            runAiTask({
              task: 'recommend',
              text: [
                paperData?.title,
                paperData?.abstract,
                ...(paperData?.references || []).map((item) => item.title),
              ].filter(Boolean).join('\n'),
              title: paperData?.title || activeDocument?.title,
              context: '生成相关论文、关键词和代码仓库方向',
              fallback: () => '当前 AI 接口不可用。建议检索方向包括目标检测、小模型鲁棒性、ImageNet 预训练、跨域检测和边缘端部署。',
              onSuccess: (result) => setAiOutputs((current) => ({
                ...current,
                [`recommend-${activeDocument?.id || 'demo'}`]: result,
              })),
            })
          }}
        >
          {aiPending === 'recommend' ? 'AI 推荐生成中' : '生成 AI 推荐'}
        </button>
      </>
    )
  }

  if (tab === 'knowledge') {
    const termItems = paperData?.terms?.length ? paperData.terms : terms
    return (
      <>
        <p>下面只保留和当前论文任务、方法、数据集、指标相关的核心概念。</p>
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
    const inferredItems = figureInferredItems
    const savedItems = (paperState.figures || []).filter((item) => item.saved || item.page === paperState.currentPage)
    const displayItems = [...inferredItems, ...savedItems].slice(0, 8)
    return (
      <>
        <p>系统会根据当前页文字线索判断图、表、公式和实验指标。识别结果可保存为当前页笔记。</p>
        {aiFigureText && (
          <section className="ai-output-card figure-ai-summary">
            <h4>AI 图表公式解释</h4>
            {formatTranslationText(aiFigureText).map((line, index) => (
              <p key={`${line.slice(0, 18)}-${index}`}>{line}</p>
            ))}
          </section>
        )}
        <div className="feature-list">
          {displayItems.length > 0 ? displayItems.map((item) => (
            <article className="figure-note-card" key={item.title}>
              <em>{item.type}</em>
              <span>
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </span>
              {item.analysis && (
                <p>
                  <b>中文分析</b>
                  {item.analysis}
                </p>
              )}
              {item.source && (
                <p className="source">
                  <b>原文依据</b>
                  {cleanPdfExtractedText(item.source).slice(0, 260)}
                </p>
              )}
            </article>
          )) : (
            <div className="empty-card">
              <strong>当前页暂未识别到明确图表公式</strong>
              <p>可以滚动到包含 Figure、Table、公式编号或实验指标的页面后再保存。</p>
            </div>
          )}
        </div>
        <button
          className="wide-action primary"
          type="button"
          disabled={inferredItems.length === 0 || aiPending === 'figure'}
          onClick={() => {
            setAiOutputs((current) => {
              const next = { ...current }
              delete next[figureOutputKey]
              return next
            })
          }}
        >
          {aiPending === 'figure' ? 'AI 解释生成中' : '重新生成图表解释'}
        </button>
        <button
          className="wide-action"
          type="button"
          disabled={inferredItems.length === 0}
          onClick={() => {
            setPaperState((current) => ({
              ...current,
              figures: [
                ...inferredItems.map((item) => ({ ...item, page: current.currentPage, saved: true, meta: `${item.meta} · 已保存` })),
                ...(current.figures || []).filter((item) => item.page !== current.currentPage),
              ],
            }))
            addTask('保存图表公式笔记', '成功')
          }}
        >
          保存当前页识别结果
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
          disabled={aiPending === 'report'}
          onClick={() => {
            runAiTask({
              task: 'report',
              text: makeReadingReport(paperData, paperState, aiOutputs),
              title: paperData?.title || activeDocument?.title,
              context: paperState.notes,
              fallback: () => makeReadingReport(paperData, paperState, aiOutputs),
              onSuccess: (report) => setAiOutputs((current) => ({
                ...current,
                report,
              })),
            })
          }}
        >
          {aiPending === 'report' ? 'AI 报告生成中' : '生成阅读报告'}
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

    if (tab === 'references') {
      const referenceItems = paperData?.references || []
      return (
        <>
          <p>这里显示 References 或 Bibliography 中提取出的参考文献。带 DOI、URL、arXiv 的条目会直接打开原始网页，其余条目会打开论文检索页。</p>
          <div className="feature-list">
            {referenceItems.length > 0 ? referenceItems.map((item) => {
              const link = item.link || makeReferenceLink(item.title)
              return (
                <a
                  className="feature-row reference-link-row"
                  key={item.title}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  title={link.href}
                  onClick={() => addTask('打开参考文献网页', '成功')}
                >
                  <em>{link.label.includes('检索') ? '检索' : '链接'}</em>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{link.label} · 点击打开网页</small>
                  </span>
                </a>
              )
            }) : (
              <div className="empty-card">
                <strong>未识别到参考文献章节</strong>
                <p>当前 PDF 暂未提取到 References 或 Bibliography 章节。请滚动到参考文献页后重新导入，或确认 PDF 文本层是否完整。</p>
              </div>
            )}
          </div>
        </>
      )
    }

    return (
      <>
        <p>{content.body}</p>
        <div className="feature-list">
          {content.items.map((item) => (
            <button
              type="button"
              className="feature-row"
              key={item}
            >
              <em>{tab === 'cards' ? '卡片' : tab === 'compare' ? '对比' : '知识'}</em>
              <span>
                <strong>{item}</strong>
                <small>点击查看详情并加入阅读记录</small>
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
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', text: '你可以问当前论文的摘要、方法、实验、术语或某一页内容。' },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatPending, setChatPending] = useState(false)

  const sendChatMessage = async () => {
    const question = chatInput.trim()
    if (!question || chatPending) return
    const pageText = paperData?.pageTexts?.find((page) => page.page === paperState.currentPage)?.text || ''
    const activeParagraphText = paperState.activeParagraph?.text || ''
    const context = [
      `当前页 ${paperState.currentPage || 1}`,
      activeParagraphText ? `当前选中段落 ${activeParagraphText}` : '',
      pageText ? `当前页文本 ${normalizeLine(pageText).slice(0, 2500)}` : '',
    ].filter(Boolean).join('\n')
    setChatInput('')
    setChatMessages((current) => [...current, { role: 'user', text: question }])
    setChatPending(true)
    try {
      const answer = await requestAi({
        task: 'chat',
        text: question,
        title: paperData?.title || activeDocument?.title,
        context,
      })
      setChatMessages((current) => [...current, { role: 'assistant', text: answer || '没有生成有效回答。' }])
    } catch (error) {
      setChatMessages((current) => [
        ...current,
        { role: 'assistant', text: error instanceof Error ? `AI 请求失败 ${error.message}` : 'AI 请求失败' },
      ])
    } finally {
      setChatPending(false)
    }
  }

  if (active === 'chat') {
    return (
      <div className="left-panel ai-chat-panel">
        <h3>AI 对话</h3>
        <div className="ai-chat-messages">
          {chatMessages.map((item, index) => (
            <article className={`ai-chat-message ${item.role}`} key={`${item.role}-${index}`}>
              <span>{item.role === 'user' ? '我' : 'AI'}</span>
              <p>{item.text}</p>
            </article>
          ))}
          {chatPending && (
            <article className="ai-chat-message assistant">
              <span>AI</span>
              <p>正在根据当前论文生成回答...</p>
            </article>
          )}
        </div>
        <div className="ai-chat-input">
          <textarea
            value={chatInput}
            placeholder="问当前论文内容"
            rows={4}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendChatMessage()
              }
            }}
          />
          <button type="button" onClick={sendChatMessage} disabled={!chatInput.trim() || chatPending}>
            发送
          </button>
        </div>
      </div>
    )
  }

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
    const bookmarkColors = ['#35568a', '#b65b5b', '#4d7d5b', '#8a6a35', '#6d5aa8']
    const bookmarks = (paperState.bookmarks || []).map((item, index) => (
      typeof item === 'string'
        ? { id: `legacy-${index}`, title: item, page: null, legacy: true }
        : item
    ))
    const updateBookmark = (targetId, changes) => {
      setPaperState((current) => ({
        ...current,
        bookmarks: (current.bookmarks || []).map((item, index) => {
          const bookmark = typeof item === 'string' ? { id: `legacy-${index}`, title: item, page: null, legacy: true } : item
          return bookmark.id === targetId ? { ...bookmark, ...changes } : item
        }),
      }))
    }
    const removeBookmark = (targetId) => {
      setPaperState((current) => ({
        ...current,
        bookmarks: (current.bookmarks || []).filter((item, index) => {
          const bookmark = typeof item === 'string' ? { id: `legacy-${index}`, title: item, page: null, legacy: true } : item
          return bookmark.id !== targetId
        }),
      }))
    }
    return (
      <div className="left-panel">
        <h3>书签</h3>
        <button
          className="wide-action"
          type="button"
          onClick={() => {
            setPaperState((current) => {
              const page = current.currentPage || 1
              const title = `第 ${page} 页`
              const currentBookmarks = current.bookmarks || []
              const filtered = currentBookmarks.filter((item) => {
                const bookmark = typeof item === 'string' ? { title: item, page: null } : item
                return bookmark.page !== page
              })
              return {
                ...current,
                bookmarks: [
                  {
                    id: `bookmark-${Date.now()}`,
                    title,
                    page,
                    color: '#35568a',
                    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
                  },
                  ...filtered,
                ],
              }
            })
          }}
        >
          添加当前页书签
        </button>
        {bookmarks.length > 0 ? bookmarks.map((item) => (
          <article
            className={`bookmark-card ${item.page === paperState.currentPage ? 'active' : ''}`}
            key={item.id || item.title}
            style={{ '--bookmark-color': item.color || '#35568a' }}
          >
            <div className="bookmark-main">
              <span className="bookmark-color-dot" />
              <span>
                <input
                  className="bookmark-name-input"
                  value={item.title}
                  aria-label="书签名称"
                  onChange={(event) => updateBookmark(item.id, { title: event.target.value })}
                />
                <small>{item.page ? `第 ${item.page} 页${item.createdAt ? ` · ${item.createdAt}` : ''}` : '旧书签缺少页码，不能跳转'}</small>
              </span>
              <button
                className="bookmark-jump"
                type="button"
                onClick={() => {
                  if (!item.page) {
                    setRightTab('notes')
                    return
                  }
                  setPaperState((current) => ({
                    ...current,
                    currentPage: item.page,
                    navigationTarget: { id: Date.now(), page: item.page, y: null },
                  }))
                  setRightTab('notes')
                }}
              >
                <ChevronRight size={15} />
              </button>
            </div>
            <div className="bookmark-controls">
              <div className="bookmark-swatches">
                {bookmarkColors.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={item.color === color ? 'selected' : ''}
                    style={{ '--swatch-color': color }}
                    aria-label="修改书签颜色"
                    onClick={() => updateBookmark(item.id, { color })}
                  />
                ))}
              </div>
              <button type="button" className="bookmark-delete" onClick={() => removeBookmark(item.id)}>
                删除
              </button>
            </div>
          </article>
        )) : (
          <p className="panel-status">还没有书签。滚动到目标页后点击上方按钮，可以在页面上留下标记。</p>
        )}
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

