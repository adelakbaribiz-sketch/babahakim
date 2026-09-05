// Probe 2: check pdfkit text output + fontkit shaping via font.data (TTFFont internals)
import PDFDocument from 'pdfkit'
import * as fs from 'fs'

async function main() {
  const doc = new PDFDocument({ size: 'A4' })
  doc.font('/usr/share/fonts/truetype/freefont/FreeSerif.ttf', 16)
  const w = doc.widthOfString('سلام باباحکیم')
  // write a real file to inspect bytes + extract embedded text
  doc.text('سلام باباحکیم BabaHakim', 50, 50)
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  doc.end()
  await new Promise((r) => doc.on('end', r))
  const buf = Buffer.concat(chunks)
  fs.writeFileSync('/home/z/my-project/tool-results/pdfkit-fa-probe.pdf', buf)
  const fontObj = (doc as any).fontMetrics ? 'hasMetrics' : 'none'
  console.log('width:', w, 'bytes:', buf.length, fontObj)
  // check fontkit shaping directly (pdfkit dep)
  const { default: fontkit } = await import('fontkit') as any
  const f2 = fontkit.openSync('/usr/share/fonts/truetype/freefont/FreeSerif.ttf')
  const run = f2.layout('سلام باباحکیم', 'fa', { features: { liga: true, rlig: true, calt: true } })
  const glyphs = run.glyphs.map((g: any) => g.name || g.id)
  console.log('fontkit glyph names:', glyphs.join(' '))
  console.log('direction:', run.direction, 'levels:', run.levels?.slice(0, 10))
}
main()
