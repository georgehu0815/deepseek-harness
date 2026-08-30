import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

function run(command, arguments_, options = {}) {
  execFileSync(command, arguments_, { stdio: 'inherit', ...options })
}

function coverFirstHtml(html) {
  const tocMatch = html.match(/<nav id="TOC"[\s\S]*?<\/nav>\s*/)
  const coverMatch = html.match(/<p><img[^>]+aria-label="DeepSeek Harness[^>]+><\/p>\s*<div class="page-break"[^>]*><\/div>\s*/)
  if (tocMatch === null || coverMatch === null) {
    throw new Error('Could not locate the generated HTML TOC and cover blocks')
  }
  const withoutBlocks = html.replace(tocMatch[0], '').replace(coverMatch[0], '')
  const tocPageBreak = '<div class="page-break" style="page-break-after: always;"></div>\n'
  const frontMatter = `${coverMatch[0]}${tocMatch[0]}${tocPageBreak}`
  const reordered = withoutBlocks.replace(/<body>\s*/, `<body>\n${frontMatter}`)
  if (reordered.indexOf('aria-label="DeepSeek Harness') > reordered.indexOf('<nav id="TOC"')) {
    throw new Error('HTML cover must precede the table of contents')
  }
  return reordered
}

function coverFirstDocumentXml(xml) {
  const tocMatch = xml.match(/\s*<w:sdt>[\s\S]*?<w:docPartGallery w:val="Table of Contents" \/>[\s\S]*?<\/w:sdt>/)
  const coverMatch = xml.match(/\s*(<w:p>[\s\S]*?<wp:docPr descr="DeepSeek Harness[\s\S]*?<\/w:p>)\s*(<w:p>[\s\S]*?<w:br w:type="page"\/>[\s\S]*?<\/w:p>)/)
  if (tocMatch === null || coverMatch === null) {
    throw new Error('Could not locate the generated DOCX TOC, cover, and page break')
  }
  const withoutBlocks = xml.replace(tocMatch[0], '').replace(coverMatch[0], '')
  const tocPageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  const frontMatter = `${coverMatch[1]}${coverMatch[2]}${tocMatch[0]}${tocPageBreak}`
  const reordered = withoutBlocks.replace('<w:body>', `<w:body>${frontMatter}`)
  if (reordered.indexOf('descr="DeepSeek Harness') > reordered.indexOf('w:val="Table of Contents"')) {
    throw new Error('DOCX cover must precede the table of contents')
  }
  return reordered
}

async function reorderDocxCover(docxPath) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'student-book-docx-'))
  try {
    run('unzip', ['-q', path.resolve(docxPath), '-d', temporary])
    const documentPath = path.join(temporary, 'word', 'document.xml')
    await writeFile(documentPath, coverFirstDocumentXml(await readFile(documentPath, 'utf8')))
    await rm(docxPath)
    run('zip', ['-q', '-r', path.resolve(docxPath), '.'], { cwd: temporary })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
export async function renderDocuments(directory, basename) {
  const outputDirectory = path.resolve(directory)
  const markdownName = `${basename}.md`
  const htmlName = `${basename}.html`
  const pdfName = `${basename}.pdf`
  const docxName = `${basename}.docx`
  const docName = `${basename}.doc`
  const temporaryHtmlName = `${basename}.pandoc.html`
  const pandocOptions = [markdownName, '--from=gfm', '--standalone', '--toc', '--toc-depth=2', '--number-sections']

  run('pandoc', [
    ...pandocOptions,
    '--embed-resources',
    '--css', 'book.css',
    '--metadata=keywords:',
    '-o', temporaryHtmlName,
  ], { cwd: outputDirectory })
  const temporaryHtmlPath = path.join(outputDirectory, temporaryHtmlName)
  const reorderedHtml = coverFirstHtml(
    await readFile(temporaryHtmlPath, 'utf8'),
  ).replace(/[ \t]+$/gm, '')
  await writeFile(path.join(outputDirectory, htmlName), reorderedHtml)
  await writeFile(path.join(outputDirectory, docName), reorderedHtml)
  await rm(temporaryHtmlPath)
  run('weasyprint', [htmlName, pdfName], { cwd: outputDirectory })

  run('pandoc', [
    ...pandocOptions,
    '--lua-filter', 'page-break.lua',
    '-o', docxName,
  ], { cwd: outputDirectory })
  await reorderDocxCover(path.join(outputDirectory, docxName))
}
