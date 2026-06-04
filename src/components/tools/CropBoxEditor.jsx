import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const MIN_SIZE = 48
const DEFAULT_BOX_RATIO = { x: 0.12, y: 0.1, width: 0.76, height: 0.78 }

const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

const buildDefaultBox = (width, height) => ({
  x: Math.round(width * DEFAULT_BOX_RATIO.x),
  y: Math.round(height * DEFAULT_BOX_RATIO.y),
  width: Math.round(width * DEFAULT_BOX_RATIO.width),
  height: Math.round(height * DEFAULT_BOX_RATIO.height),
  pageWidth: width,
  pageHeight: height,
})

const withTimeout = (promise, milliseconds, message) => (
  Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), milliseconds)
    }),
  ])
)

const cloneBytesForPdfJs = (bytes) => new Uint8Array(bytes).slice()

export function CropBoxEditor({ file, targetPage, cropBox, onCropBoxChange }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [status, setStatus] = useState('等待上传 PDF')
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let renderTask
    let loadingTask
    let quickPreviewReady = false

    const renderPdfPage = async () => {
      if (!file?.bytes || !canvasRef.current) return

      setIsReady(false)
      setPageSize({ width: 0, height: 0 })
      onCropBoxChange(null)
      const pageNumber = Math.max(Number.parseInt(targetPage, 10) || 1, 1)
      setStatus(`正在读取第 ${pageNumber} 页`)

      try {
        const metaDoc = await PDFDocument.load(file.bytes)
        const metaPageIndex = Math.min(pageNumber, metaDoc.getPageCount()) - 1
        const metaPage = metaDoc.getPage(metaPageIndex)
        const metaSize = metaPage.getSize()
        const previewScale = Math.min(620 / metaSize.width, 1.15)
        const quickSize = {
          width: Math.round(metaSize.width * previewScale),
          height: Math.round(metaSize.height * previewScale),
        }
        const quickCanvas = canvasRef.current
        const quickContext = quickCanvas?.getContext('2d', { alpha: false })
        if (!quickCanvas || !quickContext || cancelled) return
        quickCanvas.width = quickSize.width
        quickCanvas.height = quickSize.height
        quickContext.fillStyle = '#ffffff'
        quickContext.fillRect(0, 0, quickSize.width, quickSize.height)
        setPageSize(quickSize)
        onCropBoxChange(buildDefaultBox(quickSize.width, quickSize.height))
        setIsReady(true)
        quickPreviewReady = true
        setStatus('裁剪框已就绪，正在补全页面内容')

        loadingTask = pdfjsLib.getDocument({
          data: cloneBytesForPdfJs(file.bytes),
          isEvalSupported: false,
          useWorkerFetch: false,
        })
        const pdf = await withTimeout(loadingTask.promise, 60000, 'PDF.js 解析超时，已保留裁剪框')
        if (cancelled) return

        const safePageNumber = Math.min(pageNumber, pdf.numPages)
        const page = await withTimeout(pdf.getPage(safePageNumber), 8000, '页面解析超时')
        if (cancelled) return

        const viewport = page.getViewport({ scale: previewScale })
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d', { alpha: false })
        if (!canvas || !context || cancelled) return

        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)

        setStatus(`正在渲染第 ${safePageNumber} 页`)
        renderTask = page.render({ canvasContext: context, viewport })
        await withTimeout(renderTask.promise, 8000, '页面渲染超时')
        if (cancelled) return

        const nextSize = { width: canvas.width, height: canvas.height }
        setPageSize(nextSize)
        setIsReady(true)
        setStatus('拖动裁剪框或拉动边角调整范围')
      } catch (error) {
        if (cancelled) return
        if (!quickPreviewReady) {
          setIsReady(false)
          setPageSize({ width: 0, height: 0 })
          onCropBoxChange(null)
        }
        setStatus(
          error instanceof Error
            ? `PDF 内容预览未完成 ${error.message}，可以先按页面尺寸裁剪`
            : 'PDF 内容预览未完成，可以先按页面尺寸裁剪',
        )
      }
    }

    renderPdfPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
      loadingTask?.destroy()
    }
  }, [file, onCropBoxChange, targetPage])

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current || !pageSize.width || !pageSize.height) return
      const { mode, startX, startY, startBox } = dragRef.current
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

      onCropBoxChange({ ...next, pageWidth: pageSize.width, pageHeight: pageSize.height })
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
  }, [onCropBoxChange, pageSize.height, pageSize.width])

  const startDrag = (event, mode) => {
    event.preventDefault()
    event.stopPropagation()
    if (!cropBox) return

    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startBox: cropBox,
    }
  }

  if (!file) return null

  return (
    <section className="crop-editor-panel">
      <div className="crop-editor-head">
        <h3>可视化裁剪</h3>
        <p>{status}</p>
      </div>

      <div className={`crop-stage ${isReady ? 'ready' : 'loading'}`}>
        {!isReady && (
          <div className="crop-loading">正在加载真实 PDF 页面</div>
        )}

        <canvas ref={canvasRef} />

        {isReady && pageSize.width > 0 && cropBox && (
          <div
            className="crop-overlay"
            style={{ width: pageSize.width, height: pageSize.height }}
          >
            <div
              className="shade top"
              style={{ left: 0, top: 0, width: pageSize.width, height: cropBox.y }}
            />
            <div
              className="shade left"
              style={{
                left: 0,
                top: cropBox.y,
                width: cropBox.x,
                height: cropBox.height,
              }}
            />
            <div
              className="shade right"
              style={{
                left: cropBox.x + cropBox.width,
                top: cropBox.y,
                width: pageSize.width - cropBox.x - cropBox.width,
                height: cropBox.height,
              }}
            />
            <div
              className="shade bottom"
              style={{
                left: 0,
                top: cropBox.y + cropBox.height,
                width: pageSize.width,
                height: pageSize.height - cropBox.y - cropBox.height,
              }}
            />

            <button
              className="crop-box"
              type="button"
              style={{
                left: cropBox.x,
                top: cropBox.y,
                width: cropBox.width,
                height: cropBox.height,
              }}
              onMouseDown={(event) => startDrag(event, 'move')}
            >
              <span className="crop-size">
                {Math.round(cropBox.width)} x {Math.round(cropBox.height)}
              </span>
              {['nw', 'ne', 'sw', 'se'].map((handle) => (
                <i
                  aria-hidden="true"
                  className={`resize-handle ${handle}`}
                  key={handle}
                  onMouseDown={(event) => startDrag(event, handle)}
                />
              ))}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
