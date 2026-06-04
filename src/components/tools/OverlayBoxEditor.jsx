import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const MIN_SIZE = 36
const DEFAULT_COVER_COLOR = '#f1d6d6'
const DEFAULT_HIGHLIGHT_COLOR = '#ffafba'

const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

const getVariantMeta = (variant) => {
  if (variant === 'highlight') {
    return {
      title: '可视化高亮批注',
      label: '高亮',
      defaultColor: DEFAULT_HIGHLIGHT_COLOR,
      defaultOpacity: 0.45,
      readyText: '高亮批注已就绪，正在补全页面内容',
      editText: '点击高亮批注后可以拖动或拉伸',
      fallbackText: '页面内容补全失败，仍可编辑高亮批注',
      loadingText: '正在加载页面尺寸',
    }
  }

  return {
    title: '可视化遮盖',
    label: '遮盖',
    defaultColor: DEFAULT_COVER_COLOR,
    defaultOpacity: 0.9,
    readyText: '遮盖块已就绪，正在补全页面内容',
    editText: '点击遮盖块后可以拖动或拉伸',
    fallbackText: '页面内容补全失败，仍可编辑遮盖块',
    loadingText: '正在加载页面尺寸',
  }
}

const createBox = (pageWidth, pageHeight, index = 0, variant = 'cover') => {
  const meta = getVariantMeta(variant)

  return {
    id: Date.now() + index,
    x: Math.round(pageWidth * 0.16 + index * 18),
    y: Math.round(pageHeight * 0.16 + index * 18),
    width: Math.round(pageWidth * 0.32),
    height: Math.round(pageHeight * 0.06),
    pageWidth,
    pageHeight,
    color: meta.defaultColor,
    opacity: meta.defaultOpacity,
  }
}

const cloneBytesForPdfJs = (bytes) => new Uint8Array(bytes).slice()

export function OverlayBoxEditor({
  file,
  targetPage,
  boxes,
  activeBoxId,
  onBoxesChange,
  onActiveBoxChange,
  variant = 'cover',
}) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [status, setStatus] = useState('等待上传 PDF')
  const [isReady, setIsReady] = useState(false)
  const meta = getVariantMeta(variant)

  useEffect(() => {
    let cancelled = false
    let renderTask
    let loadingTask

    const renderPage = async () => {
      if (!file?.bytes || !canvasRef.current) return

      setIsReady(false)
      setPageSize({ width: 0, height: 0 })
      onBoxesChange([])
      onActiveBoxChange(null)
      const pageNumber = Math.max(Number.parseInt(targetPage, 10) || 1, 1)
      setStatus(`正在读取第 ${pageNumber} 页`)

      try {
        const metaDoc = await PDFDocument.load(file.bytes)
        const safePageNumber = Math.min(pageNumber, metaDoc.getPageCount())
        const metaPage = metaDoc.getPage(safePageNumber - 1)
        const metaSize = metaPage.getSize()
        const previewScale = Math.min(720 / metaSize.width, 1.25)
        const previewSize = {
          width: Math.round(metaSize.width * previewScale),
          height: Math.round(metaSize.height * previewScale),
        }
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d', { alpha: false })
        if (!canvas || !context || cancelled) return

        canvas.width = previewSize.width
        canvas.height = previewSize.height
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, previewSize.width, previewSize.height)
        setPageSize(previewSize)
        const firstBox = createBox(previewSize.width, previewSize.height, 0, variant)
        onBoxesChange([firstBox])
        onActiveBoxChange(firstBox.id)
        setIsReady(true)
        setStatus(meta.readyText)

        loadingTask = pdfjsLib.getDocument({
          data: cloneBytesForPdfJs(file.bytes),
          isEvalSupported: false,
          useWorkerFetch: false,
        })
        const pdf = await loadingTask.promise
        if (cancelled) return

        const page = await pdf.getPage(safePageNumber)
        if (cancelled) return

        const viewport = page.getViewport({ scale: previewScale })
        renderTask = page.render({ canvasContext: context, viewport })
        await renderTask.promise
        if (!cancelled) setStatus(meta.editText)
      } catch (error) {
        if (cancelled) return
        setStatus(error instanceof Error ? `${meta.fallbackText} ${error.message}` : meta.fallbackText)
      }
    }

    renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
      loadingTask?.destroy()
    }
  }, [file, meta.editText, meta.fallbackText, meta.readyText, onActiveBoxChange, onBoxesChange, targetPage, variant])

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current || !pageSize.width || !pageSize.height) return
      const { id, mode, startX, startY, startBox } = dragRef.current
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      let next = { ...startBox }

      if (mode === 'move') {
        next.x = clamp(startBox.x + dx, 0, pageSize.width - startBox.width)
        next.y = clamp(startBox.y + dy, 0, pageSize.height - startBox.height)
      }
      if (mode.includes('e')) {
        next.width = clamp(startBox.width + dx, MIN_SIZE, pageSize.width - startBox.x)
      }
      if (mode.includes('s')) {
        next.height = clamp(startBox.height + dy, MIN_SIZE, pageSize.height - startBox.y)
      }
      if (mode.includes('w')) {
        const nextX = clamp(startBox.x + dx, 0, startBox.x + startBox.width - MIN_SIZE)
        next.width = startBox.width + startBox.x - nextX
        next.x = nextX
      }
      if (mode.includes('n')) {
        const nextY = clamp(startBox.y + dy, 0, startBox.y + startBox.height - MIN_SIZE)
        next.height = startBox.height + startBox.y - nextY
        next.y = nextY
      }

      onBoxesChange((current) => current.map((box) => (
        box.id === id ? { ...next, pageWidth: pageSize.width, pageHeight: pageSize.height } : box
      )))
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
  }, [onBoxesChange, pageSize.height, pageSize.width])

  const startDrag = (event, box, mode) => {
    event.preventDefault()
    event.stopPropagation()
    onActiveBoxChange(box.id)
    dragRef.current = {
      id: box.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startBox: box,
    }
  }

  const addBox = () => {
    if (!pageSize.width || !pageSize.height) return
    const next = createBox(pageSize.width, pageSize.height, boxes.length, variant)
    onBoxesChange((current) => [...current, next])
    onActiveBoxChange(next.id)
  }

  const removeActiveBox = () => {
    if (!activeBoxId) return
    onBoxesChange((current) => current.filter((box) => box.id !== activeBoxId))
    onActiveBoxChange(null)
  }

  const activeBox = boxes.find((box) => box.id === activeBoxId)

  const updateActiveBox = (patch) => {
    onBoxesChange((current) => current.map((box) => (
      box.id === activeBoxId ? { ...box, ...patch } : box
    )))
  }

  if (!file) return null

  return (
    <section className="overlay-editor-panel">
      <div className="overlay-editor-head">
        <div>
          <h3>{meta.title}</h3>
          <p>{status}</p>
        </div>
        <div>
          <button type="button" disabled={!isReady} onClick={addBox}>新增{meta.label}</button>
          <button type="button" disabled={!activeBoxId} onClick={removeActiveBox}>删除选中</button>
        </div>
      </div>

      {activeBox && (
        <div className="overlay-style-panel">
          <label>
            <span>{meta.label}颜色</span>
            <input type="color" value={activeBox.color || meta.defaultColor} onChange={(event) => updateActiveBox({ color: event.target.value })} />
          </label>
          {variant === 'highlight' && (
            <label>
              <span>透明度</span>
              <input type="range" min="0.2" max="0.9" step="0.05" value={activeBox.opacity ?? meta.defaultOpacity} onChange={(event) => updateActiveBox({ opacity: Number.parseFloat(event.target.value) })} />
            </label>
          )}
          <button type="button" onClick={() => updateActiveBox({ color: meta.defaultColor, opacity: meta.defaultOpacity })}>恢复默认颜色</button>
        </div>
      )}

      <div className={`overlay-stage ${isReady ? 'ready' : 'loading'}`}>
        {!isReady && <div className="overlay-loading">{meta.loadingText}</div>}
        <canvas ref={canvasRef} />
        {isReady && pageSize.width > 0 && (
          <div className="overlay-layer" style={{ width: pageSize.width, height: pageSize.height }}>
            {boxes.map((box, index) => (
              <button
                className={`overlay-box ${box.id === activeBoxId ? 'active' : ''}`}
                key={box.id}
                type="button"
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.width,
                  height: box.height,
                  background: box.color || meta.defaultColor,
                  opacity: box.opacity ?? meta.defaultOpacity,
                }}
                onMouseDown={(event) => startDrag(event, box, 'move')}
              >
                <span>{meta.label} {index + 1}</span>
                {['nw', 'ne', 'sw', 'se'].map((handle) => (
                  <i
                    aria-hidden="true"
                    className={`resize-handle ${handle}`}
                    key={handle}
                    onMouseDown={(event) => startDrag(event, box, handle)}
                  />
                ))}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
