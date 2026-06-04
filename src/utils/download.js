import { Document, ImageRun, Packer, Paragraph, TextRun } from 'docx'

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export const downloadBytes = (bytes, filename, type = 'application/pdf') => {
  downloadBlob(new Blob([bytes], { type }), filename)
}

export const buildDocxBlobFromText = async (text) => {
  const paragraphs = (text || '未提取到文本')
    .split('\n')
    .slice(0, 200)
    .map((line) => new Paragraph({
      children: [new TextRun(line || ' ')],
      spacing: { after: 120 },
    }))
  const doc = new Document({
    sections: [{ children: paragraphs }],
  })
  return Packer.toBlob(doc)
}

const normalizeDocxLines = (text = '') => String(text)
  .split('\n')
  .map((line) => line.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .slice(0, 30)

export const buildDocxBlobFromPdfPages = async (pages, options = {}) => {
  const children = []
  const maxPages = options.maxPages || 20
  pages.slice(0, maxPages).forEach((page, index) => {
    children.push(new Paragraph({
      children: [new TextRun({ text: `第 ${page.page} 页`, bold: true })],
      spacing: { before: index === 0 ? 0 : 240, after: 120 },
    }))
    if (page.imageBytes) {
      children.push(new Paragraph({
        children: [
          new ImageRun({
            type: 'png',
            data: page.imageBytes,
            transformation: {
              width: Math.round(page.imageWidth || 520),
              height: Math.round(page.imageHeight || 720),
            },
          }),
        ],
        spacing: { after: 120 },
      }))
    }
    normalizeDocxLines(page.text).forEach((line) => {
      children.push(new Paragraph({
        children: [new TextRun(line)],
        spacing: { after: 80 },
      }))
    })
  })
  const doc = new Document({
    sections: [{ children: children.length ? children : [new Paragraph('未提取到可导出的 PDF 内容')] }],
  })
  return Packer.toBlob(doc)
}
