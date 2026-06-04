import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const MIN_SIZE = 44
const SNAP_ANGLES = [-180, -90, 0, 90, 180]
const SNAP_TOLERANCE = 6

const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

const normalizeAngle = (angle) => {
  let next = angle
  while (next > 180) next -= 360
  while (next <= -180) next += 360
  return next
}

const snapAngle = (angle) => {
  const normalized = normalizeAngle(angle)
  const target = SNAP_ANGLES.find((item) => Math.abs(normalized - item) <= SNAP_TOLERANCE)
  return target ?? Math.round(normalized)
}

const createTextBox = (pageWidth, pageHeight, index = 0) => ({
  id: Date.now() + index,
  x: Math.round(pageWidth * 0.14 + index * 18),
  y: Math.round(pageHeight * 0.16 + index * 18),
  width: Math.round(pageWidth * 0.38),
  height: 56,
  pageWidth,
  pageHeight,
  text: index === 0 ? 'New text box' : `Text box ${index + 1}`,
  fontSize: 16,
  color: '#35568a',
  fontFamily: 'Helvetica',
  bold: false,
  italic: false,
  opacity: 1,
  align: 'left',
  background: 'transparent',
  rotation: 0,
})

const cloneBytesForPdfJs = (bytes) => new Uint8Array(bytes).slice()

export function TextBoxEditor({
  file,
  targetPage,
  textBoxes,
  activeTextBoxId,
  onTextBoxesChange,
  onActiveTextBoxChange,
}) {
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
      onTextBoxesChange([])
      onActiveTextBoxChange(null)
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
        const firstTextBox = createTextBox(previewSize.width, previewSize.height)
        onTextBoxesChange([firstTextBox])
        onActiveTextBoxChange(firstTextBox.id)
        setIsReady(true)
        setStatus('文本框已就绪，正在补全页面内容')

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
        if (!cancelled) setStatus('点击文本框后可以拖动、拉伸或修改格式')
      } catch (error) {
        if (cancelled) return
        setStatus(
          error instanceof Error
            ? `页面内容补全失败 ${error.message}，仍可编辑文本框`
            : '页面内容补全失败，仍可编辑文本框',
        )
      }
    }

    renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
      loadingTask?.destroy()
    }
  }, [file, onActiveTextBoxChange, onTextBoxesChange, targetPage])

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current || !pageSize.width || !pageSize.height) return
      const { id, mode, startX, startY, startBox } = dragRef.current
      if (mode === 'rotate') {
        const centerX = startBox.x + startBox.width / 2
        const centerY = startBox.y + startBox.height / 2
        const rawAngle = Math.atan2(event.clientY - dragRef.current.stageY - centerY, event.clientX - dragRef.current.stageX - centerX) * (180 / Math.PI) + 90
        const nextAngle = snapAngle(rawAngle)
        onTextBoxesChange((current) => current.map((box) => (
          box.id === id ? { ...box, rotation: nextAngle } : box
        )))
        return
      }
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      let next = { ...startBox }

      if (mode === 'move') {
        next = {
          ...startBox,
          x: clamp(startBox.x + dx, 0, pageSize.width - startBox.width),
          y: clamp(startBox.y + dy, 0, pageSize.height - startBox.height),
          width: startBox.width,
          height: startBox.height,
        }
      } else if (mode.includes('e')) {
        next.width = clamp(startBox.width + dx, MIN_SIZE, pageSize.width - startBox.x)
      } else if (mode.includes('w')) {
        const nextX = clamp(startBox.x + dx, 0, startBox.x + startBox.width - MIN_SIZE)
        next.width = startBox.width + startBox.x - nextX
        next.x = nextX
      }

      if (mode !== 'move' && mode.includes('s')) {
        next.height = clamp(startBox.height + dy, MIN_SIZE, pageSize.height - startBox.y)
      }
      if (mode !== 'move' && mode.includes('n')) {
        const nextY = clamp(startBox.y + dy, 0, startBox.y + startBox.height - MIN_SIZE)
        next.height = startBox.height + startBox.y - nextY
        next.y = nextY
      }

      onTextBoxesChange((current) => current.map((box) => (
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
  }, [onTextBoxesChange, pageSize.height, pageSize.width])

  const updateActiveTextBox = (patch) => {
    onTextBoxesChange((current) => current.map((box) => (
      box.id === activeTextBoxId ? { ...box, ...patch } : box
    )))
  }

  const startDrag = (event, box, mode) => {
    event.preventDefault()
    event.stopPropagation()
    onActiveTextBoxChange(box.id)
    const stageRect = event.currentTarget.closest('.textbox-stage')?.getBoundingClientRect()
    dragRef.current = {
      id: box.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startBox: box,
      stageX: stageRect?.left || 0,
      stageY: stageRect?.top || 0,
    }
  }

  const addTextBox = () => {
    if (!pageSize.width || !pageSize.height) return
    const next = createTextBox(pageSize.width, pageSize.height, textBoxes.length)
    onTextBoxesChange((current) => [...current, next])
    onActiveTextBoxChange(next.id)
  }

  const removeActiveTextBox = () => {
    if (!activeTextBoxId) return
    onTextBoxesChange((current) => current.filter((box) => box.id !== activeTextBoxId))
    onActiveTextBoxChange(null)
  }

  const activeTextBox = textBoxes.find((box) => box.id === activeTextBoxId)

  if (!file) return null

  return (
    <section className="textbox-editor-panel">
      <div className="textbox-editor-head">
        <div>
          <h3>可视化文本框</h3>
          <p>{status}</p>
        </div>
        <div>
          <button type="button" disabled={!isReady} onClick={addTextBox}>新增文本框</button>
          <button type="button" disabled={!activeTextBoxId} onClick={removeActiveTextBox}>删除选中</button>
        </div>
      </div>

      {activeTextBox && (
        <div className="textbox-style-panel">
          <label>
            <span>文字</span>
            <textarea value={activeTextBox.text} onChange={(event) => updateActiveTextBox({ text: event.target.value })} />
          </label>
          <label>
            <span>字号</span>
            <input type="number" min="8" max="72" value={activeTextBox.fontSize} onChange={(event) => updateActiveTextBox({ fontSize: Number.parseInt(event.target.value, 10) || 16 })} />
          </label>
          <label>
            <span>颜色</span>
            <input type="color" value={activeTextBox.color} onChange={(event) => updateActiveTextBox({ color: event.target.value })} />
          </label>
          <label>
            <span>字体</span>
            <select value={activeTextBox.fontFamily} onChange={(event) => updateActiveTextBox({ fontFamily: event.target.value })}>
              <option value="Helvetica">Helvetica</option>
              <option value="TimesRoman">Times Roman</option>
              <option value="Courier">Courier</option>
            </select>
          </label>
          <label>
            <span>对齐</span>
            <select value={activeTextBox.align} onChange={(event) => updateActiveTextBox({ align: event.target.value })}>
              <option value="left">左对齐</option>
              <option value="center">居中</option>
              <option value="right">右对齐</option>
            </select>
          </label>
          <label>
            <span>透明度</span>
            <input type="range" min="0.2" max="1" step="0.1" value={activeTextBox.opacity} onChange={(event) => updateActiveTextBox({ opacity: Number.parseFloat(event.target.value) })} />
          </label>
          <label>
            <span>旋转</span>
            <input type="number" min="-180" max="180" value={activeTextBox.rotation} onChange={(event) => updateActiveTextBox({ rotation: normalizeAngle(Number.parseInt(event.target.value, 10) || 0) })} />
          </label>
          <label className="toggle-label">
            <input type="checkbox" checked={activeTextBox.bold} onChange={(event) => updateActiveTextBox({ bold: event.target.checked })} />
            <span>加粗</span>
          </label>
          <label className="toggle-label">
            <input type="checkbox" checked={activeTextBox.italic} onChange={(event) => updateActiveTextBox({ italic: event.target.checked })} />
            <span>斜体</span>
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={activeTextBox.background !== 'transparent'}
              onChange={(event) => updateActiveTextBox({ background: event.target.checked ? '#ffffff' : 'transparent' })}
            />
            <span>白底</span>
          </label>
        </div>
      )}

      <div className={`textbox-stage ${isReady ? 'ready' : 'loading'}`}>
        {!isReady && <div className="textbox-loading">正在加载页面尺寸</div>}
        <canvas ref={canvasRef} />
        {isReady && pageSize.width > 0 && (
          <div className="textbox-layer" style={{ width: pageSize.width, height: pageSize.height }}>
            {textBoxes.map((box) => (
              <div
                className={`textbox-box ${box.id === activeTextBoxId ? 'active' : ''}`}
                key={box.id}
                role="button"
                tabIndex={0}
                style={{
                  left: box.x,
                  top: box.y,
                  width: box.width,
                  height: box.height,
                  color: box.color,
                  fontSize: box.fontSize,
                  fontFamily: box.fontFamily === 'TimesRoman' ? 'Times New Roman' : box.fontFamily,
                  fontWeight: box.bold ? 700 : 400,
                  fontStyle: box.italic ? 'italic' : 'normal',
                  opacity: box.opacity,
                  textAlign: box.align,
                  background: box.background === 'transparent' ? 'rgb(255 255 255 / 0%)' : box.background,
                  transform: `rotate(${box.rotation || 0}deg)`,
                }}
                onMouseDown={() => onActiveTextBoxChange(box.id)}
              >
                <span className="textbox-move-area" onMouseDown={(event) => startDrag(event, box, 'move')}>{box.text}</span>
                <i
                  aria-hidden="true"
                  className="rotate-handle"
                  onMouseDown={(event) => startDrag(event, box, 'rotate')}
                >
                  ↻
                </i>
                {['nw', 'ne', 'sw', 'se'].map((handle) => (
                  <i
                    aria-hidden="true"
                    className={`resize-handle ${handle}`}
                    key={handle}
                    onMouseDown={(event) => startDrag(event, box, handle)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
