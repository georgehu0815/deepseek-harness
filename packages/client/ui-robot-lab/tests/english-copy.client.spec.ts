import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import ts from 'typescript'

it('keeps Chinese copy in locale dictionaries rather than presentation source', () => {
  const root = new URL('../src/', import.meta.url)
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map(file => file.split('\\').join('/')).filter(file => /\.tsx?$/.test(file)
      && file !== 'client/locales.ts' && file !== 'client/clip-gen-locales.ts' && file !== 'client/clip-skin-locales.ts')
  expect(files).toContain('client/RobotLab.tsx')
  const violations: string[] = []
  for (const file of files) {
    const url = new URL(file, root)
    const source = ts.createSourceFile(fileURLToPath(url), readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      // Static literals belong to the UI; dynamic names, diagnostics and user JSON are not language-restricted.
      if ((ts.isStringLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node)
        || ts.isTemplateTail(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node))
        && /\p{Script=Han}/u.test(node.text)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
        violations.push(`${file}:${line + 1}: ${node.text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(violations).toEqual([])
})
