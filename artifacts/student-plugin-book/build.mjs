/**
 * Build the student-plugin book into Markdown, HTML, and PDF.
 *
 * Pipeline:
 *   1. Read the source Markdown (with ```mermaid fences).
 *   2. Render each mermaid fence to a PNG via mmdc, replacing the fence with an
 *      image reference. This yields the distributable Markdown (portable, no
 *      renderer required to read it).
 *   3. pandoc converts that Markdown to a standalone, self-contained HTML.
 *   4. weasyprint converts the HTML to PDF using book.css for print styling.
 *
 * Tools required on PATH: mmdc (@mermaid-js/mermaid-cli), pandoc, weasyprint.
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const BASENAME = 'deepseek-harness-student-plugin-book'

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', cwd: here, ...options })
}

/** Render every mermaid fence to a PNG and swap in an image reference. */
async function renderMermaid(markdown) {
  const fences = [...markdown.matchAll(/^```mermaid\n([\s\S]*?)^```$/gm)]
  let index = 0
  const replacements = []
  for (const fence of fences) {
    index += 1
    const mmd = `diagram-${index}.mmd`
    const png = `diagram-${index}.png`
    await writeFile(path.join(here, mmd), fence[1])
    // -b white gives an opaque background so the PNG reads on any page.
    // -p puppeteer.json passes --no-sandbox so Chromium launches under the
    // host sandbox; -b white gives an opaque background; -s 2 doubles scale.
    run('mmdc', ['-p', 'puppeteer.json', '-i', mmd, '-o', png, '-b', 'white', '-s', '2'])
    replacements.push({ from: fence[0], to: `![Diagram ${index}](${png})` })
  }
  let out = markdown
  for (const r of replacements) out = out.replace(r.from, r.to)
  console.log(`Rendered ${index} Mermaid diagram(s).`)
  return out
}

/**
 * Move the cover image paragraph to the very top of <body>, before pandoc's
 * generated table of contents, so the PDF opens on the full-bleed cover.
 */
function coverFirst(html) {
  const coverMatch = html.match(/<p><img[^>]*src="data:image\/svg\+xml[^>]*><\/p>\s*/)
  if (coverMatch === null) throw new Error('Could not locate the cover image paragraph')
  const withoutCover = html.replace(coverMatch[0], '')
  const reordered = withoutCover.replace(/<body>\s*/, `<body>\n${coverMatch[0]}`)
  const tocIndex = reordered.indexOf('id="TOC"')
  if (tocIndex !== -1 && reordered.indexOf('data:image/svg+xml') > tocIndex) {
    throw new Error('Cover must precede the table of contents')
  }
  return reordered
}

async function main() {
  const source = await readFile(path.join(here, `${BASENAME}.source.md`), 'utf8')
  const withImages = await renderMermaid(source)

  const mdName = `${BASENAME}.md`
  const htmlName = `${BASENAME}.html`
  const pdfName = `${BASENAME}.pdf`
  await writeFile(path.join(here, mdName), withImages)

  run('pandoc', [
    mdName,
    '--from=gfm',
    '--standalone',
    '--toc',
    '--toc-depth=3',
    '--embed-resources',
    '--css', 'book.css',
    '--metadata=title:Building a DeepSeek Harness Plugin — A Student Book',
    '-o', htmlName,
  ])

  await writeFile(path.join(here, htmlName), coverFirst(await readFile(path.join(here, htmlName), 'utf8')))

  run('weasyprint', [htmlName, pdfName])
  console.log(`\nBuilt: ${mdName}, ${htmlName}, ${pdfName}`)
}

await main()
