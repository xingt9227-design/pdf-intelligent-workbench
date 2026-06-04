import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const clamp = (value, min, max) => Math.max(min, Math.min(value, max))
const cloneBytesForPdfJs = (bytes) => new Uint8Array(bytes).slice()

const createDefaultWatermark = (pageWidth, pageHeight) => ({
  text: 'PDF Workbench',
  x: Math.round(pageWidth * 0.28),
  y: Math.round(pageHeight * 0.46),
  pageWidth,
  pageHeight,
  fontSize: 26,
  color: '#8b9bc1',
  opacity: 0.28,
  rotation: -32,
  layout: 'tile',
  gapX: 250,
  gapY: 150,
  applyToAllPages: true,
})

export function WatermarkEditor({ file, targetPage, watermark, onWatermarkChange }) {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [status, setStatus] = useState('等待上传 PDF')
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let renderTask
    let loadingTask

    const renderPage = async () => {
      if (!file?.bytes || !canvasRef.current) return
      setIsReady(false)
      setPageSize({ width: 0, height: 0 })
      const pageNumber = Math.max(Number.parseInt(targetPage, 10) || 1, 1)
      setStatus(`正在读取第 ${pageNumber} 页`)

      try {
        const metaDoc = await PDFDocument.load(file.bytes)
        const safePageNumber = Math.min(pageNumber, metaDoc.getPageCount())
        const metaPage = metaDoc.getPage(safePageNumber - 1)
        const metaSize = metaPage.getSize()
        const previewScale = Math.min(760 / metaSize.width, 1.3)
        const previewSize = {
          width: Math.round(metaSize.width * previewScale),
          height: Math.round(metaSize.height * previewScale),
        }

        const canvas = canvasRef.current
        const context = canvas.getContext('2d', { alpha: false })
        const outputScale = Math.max(window.devicePixelRatio || 1, 1)
        canvas.width = Math.round(previewSize.width * outputScale)
        canvas.height = Math.round(previewSize.height * outputScale)
        canvas.style.width = `${previewSize.width}px`
        canvas.style.height = `${previewSize.height}px`
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, previewSize.width, previewSize.height)
        setPageSize(previewSize)
        onWatermarkChange((current) => {
          if (current && current.pageWidth === previewSize.width && current.pageHeight === previewSize.height) return current
          return createDefaultWatermark(previewSize.width, previewSize.height)
        })

        loadingTask = pdfjsLib.getDocument({
          data: cloneBytesForPdfJs(file.bytes),
          isEvalSupported: false,
          useWorkerFetch: false,
        })
        const pdf = await loadingTask.promise
        if (cancelled) return

        const page = await pdf.getPage(safePageNumber)
        const viewport = page.getViewport({ scale: previewScale })
        renderTask = page.render({ canvasContext: context, viewport })
        await renderTask.promise
        if (!cancelled) {
          setIsReady(true)
          setStatus('拖动水印可以调整位置，右侧参数会实时预览')
        }
      } catch (error) {
        if (cancelled) return
        setStatus(error instanceof Error ? `水印预览加载失败 ${error.message}` : '水印预览加载失败')
      }
    }

    renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
      loadingTask?.destroy()
    }
  }, [file, onWatermarkChange, targetPage])

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current || !pageSize.width || !pageSize.height) return
      const { startX, startY, startWatermark } = dragRef.current
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      onWatermarkChange((current) => ({
        ...(current || startWatermark),
        x: clamp(startWatermark.x + dx, 0, pageSize.width),
        y: clamp(startWatermark.y + dy, 0, pageSize.height),
        pageWidth: pageSize.width,
        pageHeight: pageSize.height,
      }))
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
  }, [onWatermarkChange, pageSize.height, pageSize.width])

  const updateWatermark = (patch) => {
    onWatermarkChange((current) => ({
      ...(current || createDefaultWatermark(pageSize.width, pageSize.height)),
      ...patch,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
    }))
  }

  const tileItems = []
  if (watermark && pageSize.width > 0 && watermark.layout === 'tile') {
    const gapX = Number(watermark.gapX) || 250
    const gapY = Number(watermark.gapY) || 150
    for (let y = -gapY; y <= pageSize.height + gapY; y += gapY) {
      for (let x = -gapX; x <= pageSize.width + gapX; x += gapX) {
        tileItems.push({ x, y, id: `${x}-${y}` })
      }
    }
  }

  const startDrag = (event) => {
    if (!watermark) return
    event.preventDefault()
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWatermark: watermark,
    }
  }

  if (!file) return null

  return (
    <section className="watermark-editor-panel">
      <div className="overlay-editor-head">
        <div>
          <h3>可视化水印签名</h3>
          <p>{status}</p>
        </div>
      </div>

      <div className="watermark-controls">
        <label>
          <span>文字</span>
          <input value={watermark?.text || ''} onChange={(event) => updateWatermark({ text: event.target.value })} />
        </label>
        <label>
          <span>颜色</span>
          <input type="color" value={watermark?.color || '#8b9bc1'} onChange={(event) => updateWatermark({ color: event.target.value })} />
        </label>
        <label>
          <span>字号</span>
          <input type="number" min="10" max="96" value={watermark?.fontSize || 34} onChange={(event) => updateWatermark({ fontSize: Number.parseInt(event.target.value, 10) || 34 })} />
        </label>
        <label>
          <span>透明度</span>
          <input type="range" min="0.1" max="0.9" step="0.05" value={watermark?.opacity ?? 0.35} onChange={(event) => updateWatermark({ opacity: Number.parseFloat(event.target.value) })} />
        </label>
        <label>
          <span>旋转</span>
          <input type="range" min="-90" max="90" step="1" value={watermark?.rotation ?? -28} onChange={(event) => updateWatermark({ rotation: Number.parseInt(event.target.value, 10) || 0 })} />
        </label>
        <label>
          <span>布局</span>
          <select value={watermark?.layout || 'tile'} onChange={(event) => updateWatermark({ layout: event.target.value })}>
            <option value="tile">平铺水印</option>
            <option value="single">单个签名</option>
          </select>
        </label>
        {watermark?.layout !== 'single' && (
          <>
            <label>
              <span>横向间距</span>
              <input type="number" min="80" max="600" value={watermark?.gapX || 250} onChange={(event) => updateWatermark({ gapX: Number.parseInt(event.target.value, 10) || 250 })} />
            </label>
            <label>
              <span>纵向间距</span>
              <input type="number" min="60" max="400" value={watermark?.gapY || 150} onChange={(event) => updateWatermark({ gapY: Number.parseInt(event.target.value, 10) || 150 })} />
            </label>
          </>
        )}
        <label className="watermark-check">
          <input type="checkbox" checked={watermark?.applyToAllPages ?? true} onChange={(event) => updateWatermark({ applyToAllPages: event.target.checked })} />
          <span>应用到全部页面</span>
        </label>
      </div>

      <div className="watermark-stage">
        {!isReady && <div className="overlay-loading">正在加载水印预览</div>}
        <canvas ref={canvasRef} />
        {isReady && watermark?.layout === 'tile' && pageSize.width > 0 && (
          <div className="watermark-tile-layer" style={{ width: pageSize.width, height: pageSize.height }}>
            {tileItems.map((item) => (
              <span
                key={item.id}
                style={{
                  left: item.x,
                  top: item.y,
                  color: watermark.color,
                  fontSize: watermark.fontSize,
                  opacity: watermark.opacity,
                  transform: `rotate(${watermark.rotation}deg)`,
                }}
              >
                {watermark.text || 'PDF Workbench'}
              </span>
            ))}
          </div>
        )}
        {isReady && watermark?.layout !== 'tile' && pageSize.width > 0 && (
          <button
            className="watermark-preview"
            type="button"
            style={{
              left: watermark.x,
              top: watermark.y,
              color: watermark.color,
              fontSize: watermark.fontSize,
              opacity: watermark.opacity,
              transform: `translate(-50%, -50%) rotate(${watermark.rotation}deg)`,
            }}
            onMouseDown={startDrag}
          >
            {watermark.text || 'PDF Workbench'}
          </button>
        )}
      </div>
    </section>
  )
}
