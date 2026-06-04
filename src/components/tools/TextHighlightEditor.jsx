import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const DEFAULT_HIGHLIGHT_COLOR = '#ffafba'
const DEFAULT_HIGHLIGHT_OPACITY = 0.36

const cloneBytesForPdfJs = (bytes) => new Uint8Array(bytes).slice()

const normalizeSelectionRects = (rects, pageSize) => {
  const items = rects
    .map((rect) => {
      const padX = Math.max(1, Math.round(rect.height * 0.08))
      const padY = Math.max(1, Math.round(rect.height * 0.04))
      const x = Math.max(0, rect.x - padX)
      const y = Math.max(0, rect.y - padY)
      const right = Math.min(pageSize.width, rect.x + rect.width + padX)
      const bottom = Math.min(pageSize.height, rect.y + rect.height + padY)
      return {
        x,
        y,
        width: right - x,
        height: bottom - y,
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
        centerY: y + (bottom - y) / 2,
      }
    })
    .filter((rect) => rect.width > 3 && rect.height > 3)
    .sort((a, b) => (Math.abs(a.centerY - b.centerY) < 2 ? a.x - b.x : a.centerY - b.centerY))

  const lines = []
  items.forEach((rect) => {
    const line = lines.find((row) => Math.abs(row.centerY - rect.centerY) <= Math.max(5, rect.height * 0.42))
    if (!line) {
      lines.push({ centerY: rect.centerY, rects: [rect] })
      return
    }
    line.rects.push(rect)
    line.centerY = line.rects.reduce((sum, item) => sum + item.centerY, 0) / line.rects.length
  })

  return lines.flatMap((line) => {
    const merged = []
    line.rects
      .sort((a, b) => a.x - b.x)
      .forEach((rect) => {
        const previous = merged.at(-1)
        const allowedGap = Math.max(3, rect.height * 0.28)
        if (previous && rect.x - (previous.x + previous.width) <= allowedGap) {
          const right = Math.max(previous.x + previous.width, rect.x + rect.width)
          const bottom = Math.max(previous.y + previous.height, rect.y + rect.height)
          previous.y = Math.min(previous.y, rect.y)
          previous.width = right - previous.x
          previous.height = bottom - previous.y
        } else {
          merged.push({ ...rect })
        }
      })

    return merged.map((rect) => ({
      ...rect,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }))
  })
}

const rectsFromSelection = (selection, layerElement, pageSize) => {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !layerElement) return []
  if (!layerElement.contains(selection.anchorNode) || !layerElement.contains(selection.focusNode)) return []

  const range = selection.getRangeAt(0)
  const layerRect = layerElement.getBoundingClientRect()
  const rawRects = Array.from(range.getClientRects()).map((rect) => {
    const x = Math.max(0, rect.left - layerRect.left)
    const y = Math.max(0, rect.top - layerRect.top)
    const right = Math.min(layerRect.width, rect.right - layerRect.left)
    const bottom = Math.min(layerRect.height, rect.bottom - layerRect.top)
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
    }
  })

  return normalizeSelectionRects(rawRects, pageSize)
}

export function TextHighlightEditor({
  file,
  targetPage,
  highlights,
  activeHighlightId,
  onHighlightsChange,
  onActiveHighlightChange,
}) {
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [status, setStatus] = useState('等待上传 PDF')
  const [isReady, setIsReady] = useState(false)
  const [pendingRects, setPendingRects] = useState([])
  const [pendingText, setPendingText] = useState('')
  const [color, setColor] = useState(DEFAULT_HIGHLIGHT_COLOR)
  const [opacity, setOpacity] = useState(DEFAULT_HIGHLIGHT_OPACITY)

  const activeHighlight = useMemo(
    () => highlights.find((highlight) => highlight.id === activeHighlightId),
    [activeHighlightId, highlights],
  )

  useEffect(() => {
    let cancelled = false
    let loadingTask
    let renderTask
    let textLayer

    const renderPage = async () => {
      if (!file?.bytes || !canvasRef.current || !textLayerRef.current) return
      setIsReady(false)
      setPageSize({ width: 0, height: 0 })
      setPendingRects([])
      setPendingText('')
      onHighlightsChange([])
      onActiveHighlightChange(null)

      const requestedPage = Math.max(Number.parseInt(targetPage, 10) || 1, 1)
      setStatus(`正在读取第 ${requestedPage} 页`)

      try {
        const metaDoc = await PDFDocument.load(file.bytes)
        const pageNumber = Math.min(requestedPage, metaDoc.getPageCount())
        const metaPage = metaDoc.getPage(pageNumber - 1)
        const metaSize = metaPage.getSize()
        const previewScale = Math.min(920 / metaSize.width, 1.55)
        const previewSize = {
          width: Math.round(metaSize.width * previewScale),
          height: Math.round(metaSize.height * previewScale),
        }

        const canvas = canvasRef.current
        const textLayerElement = textLayerRef.current
        const context = canvas.getContext('2d', { alpha: false })
        const outputScale = Math.max(window.devicePixelRatio || 1, 1)

        canvas.width = Math.round(previewSize.width * outputScale)
        canvas.height = Math.round(previewSize.height * outputScale)
        canvas.style.width = `${previewSize.width}px`
        canvas.style.height = `${previewSize.height}px`
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, previewSize.width, previewSize.height)

        textLayerElement.replaceChildren()
        textLayerElement.style.width = `${previewSize.width}px`
        textLayerElement.style.height = `${previewSize.height}px`
        textLayerElement.style.setProperty('--scale-factor', String(previewScale))
        textLayerElement.style.setProperty('--total-scale-factor', String(previewScale))
        setPageSize(previewSize)

        loadingTask = pdfjsLib.getDocument({
          data: cloneBytesForPdfJs(file.bytes),
          isEvalSupported: false,
          useWorkerFetch: false,
        })
        const pdf = await loadingTask.promise
        if (cancelled) return

        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: previewScale })
        renderTask = page.render({ canvasContext: context, viewport })
        await renderTask.promise
        if (cancelled) return

        const textContent = await page.getTextContent()
        textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerElement,
          viewport,
        })
        await textLayer.render()
        if (cancelled) return

        setIsReady(true)
        setStatus('拖选 PDF 文字后保存为高亮批注')
      } catch (error) {
        if (cancelled) return
        setStatus(error instanceof Error ? `文字层加载失败 ${error.message}` : '文字层加载失败')
      }
    }

    renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
      loadingTask?.destroy()
      textLayer?.cancel()
    }
  }, [file, onActiveHighlightChange, onHighlightsChange, targetPage])

  const captureSelection = () => {
    if (!isReady || !textLayerRef.current) return
    const selection = window.getSelection()
    const text = selection?.toString().trim() || ''
    const rects = rectsFromSelection(selection, textLayerRef.current, pageSize)
    if (!text || rects.length === 0) return
    setPendingText(text)
    setPendingRects(rects)
    setStatus(`已选择 ${text.length} 个字符，可以保存高亮`)
  }

  const saveSelection = () => {
    if (pendingRects.length === 0) return
    const next = {
      id: Date.now(),
      rects: pendingRects,
      text: pendingText,
      color,
      opacity,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
    }
    onHighlightsChange((current) => [...current, next])
    onActiveHighlightChange(next.id)
    setPendingRects([])
    setPendingText('')
    window.getSelection()?.removeAllRanges()
    setStatus('高亮批注已保存，可以继续选择文字')
  }

  const removeActiveHighlight = () => {
    if (!activeHighlightId) return
    onHighlightsChange((current) => current.filter((highlight) => highlight.id !== activeHighlightId))
    onActiveHighlightChange(null)
  }

  const updateActiveHighlight = (patch) => {
    if (!activeHighlightId) return
    onHighlightsChange((current) => current.map((highlight) => (
      highlight.id === activeHighlightId ? { ...highlight, ...patch } : highlight
    )))
  }

  const visibleHighlights = [
    ...highlights,
    ...(pendingRects.length > 0
      ? [{ id: 'pending-selection', rects: pendingRects, color, opacity, text: pendingText, pending: true }]
      : []),
  ]

  if (!file) return null

  return (
    <section className="text-highlight-panel">
      <div className="overlay-editor-head">
        <div>
          <h3>文字高亮批注</h3>
          <p>{status}</p>
        </div>
        <div>
          <button type="button" disabled={pendingRects.length === 0} onClick={saveSelection}>保存选中文字</button>
          <button type="button" disabled={!activeHighlightId} onClick={removeActiveHighlight}>删除选中</button>
        </div>
      </div>

      <div className="overlay-style-panel">
        <label>
          <span>默认颜色</span>
          <input
            type="color"
            value={activeHighlight?.color || color}
            onChange={(event) => {
              setColor(event.target.value)
              updateActiveHighlight({ color: event.target.value })
            }}
          />
        </label>
        <label>
          <span>透明度</span>
          <input
            type="range"
            min="0.2"
            max="0.9"
            step="0.05"
            value={activeHighlight?.opacity ?? opacity}
            onChange={(event) => {
              const nextOpacity = Number.parseFloat(event.target.value)
              setOpacity(nextOpacity)
              updateActiveHighlight({ opacity: nextOpacity })
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setColor(DEFAULT_HIGHLIGHT_COLOR)
            setOpacity(DEFAULT_HIGHLIGHT_OPACITY)
            updateActiveHighlight({ color: DEFAULT_HIGHLIGHT_COLOR, opacity: DEFAULT_HIGHLIGHT_OPACITY })
          }}
        >
          恢复默认粉色
        </button>
      </div>

      {pendingText && <p className="highlight-selection-text">当前选择 {pendingText}</p>}

      <div className="highlight-stage" onMouseUp={captureSelection}>
        {!isReady && <div className="overlay-loading">正在加载可选择文字层</div>}
        <canvas ref={canvasRef} />
        <div className="textLayer pdf-text-layer" ref={textLayerRef} />
        {pageSize.width > 0 && (
          <div className="saved-highlight-layer" style={{ width: pageSize.width, height: pageSize.height }}>
            {visibleHighlights.flatMap((highlight) => highlight.rects.map((rect, index) => (
              <button
                aria-label="高亮批注"
                className={`saved-highlight ${highlight.id === activeHighlightId ? 'active' : ''} ${highlight.pending ? 'pending' : ''}`}
                key={`${highlight.id}-${index}`}
                type="button"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  background: highlight.color || DEFAULT_HIGHLIGHT_COLOR,
                  opacity: highlight.opacity ?? DEFAULT_HIGHLIGHT_OPACITY,
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!highlight.pending) onActiveHighlightChange(highlight.id)
                }}
              />
            )))}
          </div>
        )}
      </div>

      {highlights.length > 0 && (
        <div className="highlight-list">
          {highlights.map((highlight, index) => (
            <button
              className={highlight.id === activeHighlightId ? 'active' : ''}
              key={highlight.id}
              type="button"
              onClick={() => onActiveHighlightChange(highlight.id)}
            >
              高亮 {index + 1} {highlight.text.slice(0, 36)}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
