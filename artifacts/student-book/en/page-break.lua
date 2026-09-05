local function is_page_break(html)
  local classes = html:match('class%s*=%s*["\']([^"\']*)["\']')
  return html:match('^%s*<div[%s>]') ~= nil
    and classes ~= nil
    and (' ' .. classes .. ' '):find(' page%-break ') ~= nil
    and html:match('</div>%s*$') ~= nil
end

function RawBlock(element)
  if element.format ~= 'html' or not is_page_break(element.text) then
    return nil
  end

  if FORMAT:match('docx') then
    return pandoc.RawBlock('openxml', '<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
  end

  if FORMAT:match('html') then
    return element
  end
end
