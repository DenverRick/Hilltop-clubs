// Minimal, self-contained Markdown → HTML renderer for the Club Newsletter.
// No external dependency. Content is authored by a trusted (gated) editor, but
// this is still safe: HTML is neutralized by escaping & and < (so no tags can
// be injected from the source), and link/image URLs are scheme-checked.
//
// Supports: # .. ###### headings, **bold**/__bold__, *italic*/_italic_,
// `inline code`, [text](url), ![alt](url), "-"/"*" bullet lists, "1." ordered
// lists, "> " blockquotes, "---" horizontal rules, fenced ``` code blocks, and
// paragraphs (blank-line separated; single newlines become <br>). Emoji are
// just characters and pass straight through. Exposed as window.renderMarkdown.
(function () {
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // Allow only safe URL schemes; everything else becomes "#". Input has already
  // been &-escaped by esc(), so we only neutralize quotes here.
  function safeUrl(u) {
    const t = String(u).trim();
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(t)) return '#';
    return t.replace(/"/g, '%22');
  }

  function inline(t) {
    // Images before links (both use the [..](..) shape).
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy" />`);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, tx, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener">${tx}</a>`);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Italic with underscores only at word boundaries, so URLs like a_b_c are safe.
    t = t.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    return t;
  }

  function render(src) {
    const lines = esc(String(src || '').replace(/\r\n?/g, '\n')).split('\n');
    const out = [];
    let para = [], listType = null, inCode = false, code = [];
    const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^```/.test(line)) {
        if (inCode) { out.push('<pre><code>' + code.join('\n') + '</code></pre>'); code = []; inCode = false; }
        else { flushPara(); closeList(); inCode = true; }
        continue;
      }
      if (inCode) { code.push(line); continue; }
      if (/^\s*$/.test(line)) { flushPara(); closeList(); continue; }

      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flushPara(); closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); continue; }
      if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { flushPara(); if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
      if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) { flushPara(); if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }

      closeList();
      para.push(line);
    }
    flushPara(); closeList();
    if (inCode) out.push('<pre><code>' + code.join('\n') + '</code></pre>');
    return out.join('\n');
  }

  window.renderMarkdown = render;
})();
