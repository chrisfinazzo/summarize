// Lightweight Markdown → HTML for the summarize docs site.
// No deps. Handles headings, paragraphs, lists, fenced code, blockquotes,
// pipe tables, inline code, bold/italic, links (with .md rewriting), and
// per-language syntax highlighting consistent with the docs CSS.

export function renderMarkdown(markdown, currentRel, hooks = {}) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = null;
  let fence = null;
  let blockquote = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join(" "), currentRel, hooks)}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };
  const flushBlockquote = () => {
    if (!blockquote.length) return;
    const inner = renderMarkdown(blockquote.join("\n"), currentRel, hooks);
    html.push(`<blockquote>${inner}</blockquote>`);
    blockquote = [];
  };
  const splitRow = (line) => {
    let trimmed = line.trim();
    if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
    if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
    const cells = [];
    let current = "";
    for (let idx = 0; idx < trimmed.length; idx++) {
      const char = trimmed[idx];
      if (char === "\\" && trimmed[idx + 1] === "|") {
        current += "\\|";
        idx += 1;
        continue;
      }
      if (char === "|") {
        cells.push(current.trim().replace(/\\\|/g, "|"));
        current = "";
        continue;
      }
      current += char;
    }
    cells.push(current.trim().replace(/\\\|/g, "|"));
    return cells;
  };
  const isDivider = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^```([\w+-]+)?\s*$/);
    if (fenceMatch) {
      flushParagraph();
      closeList();
      flushBlockquote();
      if (fence) {
        const body = highlightCode(fence.lines.join("\n"), fence.lang);
        html.push(`<pre><code class="language-${escapeAttr(fence.lang)}">${body}</code></pre>`);
        fence = null;
      } else {
        fence = { lang: fenceMatch[1] || "text", lines: [] };
      }
      continue;
    }
    if (fence) {
      fence.lines.push(line);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      closeList();
      blockquote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushBlockquote();
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      closeList();
      html.push("<hr>");
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slug(text);
      const inner = inline(text, currentRel, hooks);
      if (level === 1) {
        html.push(`<h1 id="${id}">${inner}</h1>`);
      } else {
        html.push(
          `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-label="Anchor link">#</a>${inner}</h${level}>`,
        );
      }
      continue;
    }
    if (
      line.trimStart().startsWith("|") &&
      line.includes("|", line.indexOf("|") + 1) &&
      isDivider(lines[i + 1] || "")
    ) {
      flushParagraph();
      closeList();
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return right && left ? "center" : right ? "right" : left ? "left" : "";
      });
      i += 1;
      const rows = [];
      while (i + 1 < lines.length && lines[i + 1].trimStart().startsWith("|")) {
        i += 1;
        rows.push(splitRow(lines[i]));
      }
      const th = header
        .map(
          (c, idx) =>
            `<th${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ""}>${inline(c, currentRel, hooks)}</th>`,
        )
        .join("");
      const tb = rows
        .map(
          (r) =>
            `<tr>${r.map((c, idx) => `<td${aligns[idx] ? ` style="text-align:${aligns[idx]}"` : ""}>${inline(c, currentRel, hooks)}</td>`).join("")}</tr>`,
        )
        .join("");
      html.push(`<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`);
      continue;
    }
    const bullet = line.match(/^\s*-\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list && list !== tag) closeList();
      if (!list) {
        list = tag;
        html.push(`<${tag}>`);
      }
      html.push(`<li>${inline((bullet || numbered)[1], currentRel, hooks)}</li>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  flushBlockquote();
  return html.join("\n");
}

export function tocFromHtml(html) {
  const items = [];
  const re = /<h([23]) id="([^"]+)">([\s\S]*?)<\/h[23]>/g;
  let m;
  while ((m = re.exec(html))) {
    const text = m[3]
      .replace(/<a class="anchor"[^>]*>.*?<\/a>/, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    items.push({ level: Number(m[1]), id: m[2], text });
  }
  if (items.length < 2) return "";
  return `<nav class="toc" aria-label="On this page"><h2>On this page</h2>${items
    .map((i) => `<a class="toc-l${i.level}" href="#${i.id}">${escapeHtml(i.text)}</a>`)
    .join("")}</nav>`;
}

export function slug(text) {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

function inline(text, currentRel, hooks) {
  const stash = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    stash.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${stash.length - 1}\u0000`;
  });
  out = escapeHtml(out)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_, label, href) =>
        `<a href="${escapeAttr(rewriteHref(href, currentRel, hooks))}">${label}</a>`,
    )
    .replace(/&lt;(https?:\/\/[^\s<>]+)&gt;/g, '<a href="$1">$1</a>');
  out = out.replace(/\\\|/g, "|");
  out = out.replace(/&lt;br&gt;/g, "<br>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

function rewriteHref(href, currentRel, hooks) {
  if (typeof hooks.rewriteHref === "function") {
    return hooks.rewriteHref(href, currentRel);
  }
  return href;
}

function highlightCode(code, lang) {
  const language = (lang || "text").toLowerCase();
  if (
    language === "bash" ||
    language === "sh" ||
    language === "shell" ||
    language === "zsh" ||
    language === "console"
  ) {
    return highlightShell(code);
  }
  if (language === "json" || language === "json5") return highlightJson(code);
  if (
    language === "ts" ||
    language === "typescript" ||
    language === "js" ||
    language === "javascript" ||
    language === "tsx" ||
    language === "jsx"
  ) {
    return highlightJs(code);
  }
  if (language === "go" || language === "golang") return highlightGo(code);
  if (language === "yaml" || language === "yml") return highlightYaml(code);
  return escapeHtml(code);
}

function stashToken(idx) {
  return String.fromCharCode(0xe000 + idx);
}

function restoreStashTokens(value, stash) {
  return value.replace(/[\ue000-\uf8ff]/g, (token) => {
    const idx = token.charCodeAt(0) - 0xe000;
    return stash[idx] ?? "";
  });
}

function withStash(code, patterns) {
  const stash = [];
  let working = code;
  for (const [re, cls] of patterns) {
    working = working.replace(re, (match) => {
      const idx = stash.length;
      stash.push(`<span class="${cls}">${escapeHtml(match)}</span>`);
      return stashToken(idx);
    });
  }
  return restoreStashTokens(escapeHtml(working), stash);
}

function highlightShell(code) {
  return code
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return `<span class="hl-c">${escapeHtml(line)}</span>`;
      const promptMatch = line.match(/^(\s*)([$#>])(\s+)(.*)$/);
      if (promptMatch) {
        const [, lead, sym, gap, rest] = promptMatch;
        return `${escapeHtml(lead)}<span class="hl-p">${escapeHtml(sym)}</span>${escapeHtml(gap)}${highlightShellLine(rest)}`;
      }
      return highlightShellLine(line);
    })
    .join("\n");
}

function highlightShellLine(line) {
  const stash = [];
  const stashAdd = (match, cls) => {
    const idx = stash.length;
    stash.push(`<span class="${cls}">${escapeHtml(match)}</span>`);
    return stashToken(idx);
  };
  let working = line;
  working = working.replace(/(?:'[^']*'|"[^"]*")/g, (m) => stashAdd(m, "hl-s"));
  working = working.replace(/\s#.*$/g, (m) => stashAdd(m, "hl-c"));
  working = working.replace(
    /(^|\s)(--?[A-Za-z][A-Za-z0-9-]*)/g,
    (_, lead, flag) => `${escapeHtml(lead)}${stashAdd(flag, "hl-f")}`,
  );
  working = working.replace(
    /\b(summarize|summarizer|brew|npm|pnpm|node|npx|tsx|bunx|bun|git|gh|make|sudo|cd|export|cat|curl|jq|ls|mv|cp|rm|mkdir|tail|docker|pbpaste|pbcopy|wc|awk|sed|tr|grep|ffmpeg|yt-dlp|whisper|tesseract)\b/g,
    (m) => stashAdd(m, "hl-cmd"),
  );
  working = working.replace(/\b(\d+(?:\.\d+)?)\b/g, (m) => stashAdd(m, "hl-n"));
  return restoreStashTokens(escapeHtml(working), stash);
}

function highlightJson(code) {
  return withStash(code, [
    [/"(?:\\.|[^"\\])*"\s*:/g, "hl-k"],
    [/"(?:\\.|[^"\\])*"/g, "hl-s"],
    [/\b(true|false|null)\b/g, "hl-m"],
    [/-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, "hl-n"],
  ]);
}

function highlightJs(code) {
  return withStash(code, [
    [/\/\/[^\n]*/g, "hl-c"],
    [/\/\*[\s\S]*?\*\//g, "hl-c"],
    [/`(?:\\.|[^`\\])*`/g, "hl-s"],
    [/"(?:\\.|[^"\\])*"/g, "hl-s"],
    [/'(?:\\.|[^'\\])*'/g, "hl-s"],
    [
      /\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|extends|new|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|interface|type|enum|as|of|in|null|undefined|true|false|this)\b/g,
      "hl-k",
    ],
    [/\b(\d+(?:\.\d+)?)\b/g, "hl-n"],
  ]);
}

function highlightGo(code) {
  return withStash(code, [
    [/\/\/[^\n]*/g, "hl-c"],
    [/\/\*[\s\S]*?\*\//g, "hl-c"],
    [/`[^`]*`/g, "hl-s"],
    [/"(?:\\.|[^"\\])*"/g, "hl-s"],
    [
      /\b(package|import|func|return|if|else|for|range|switch|case|break|continue|default|type|struct|interface|map|chan|go|defer|select|var|const|nil|true|false|iota)\b/g,
      "hl-k",
    ],
    [/\b(\d+(?:\.\d+)?)\b/g, "hl-n"],
  ]);
}

function highlightYaml(code) {
  return code
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return `<span class="hl-c">${escapeHtml(line)}</span>`;
      const m = line.match(/^(\s*-?\s*)([A-Za-z0-9_.-]+)(\s*:)(.*)$/);
      if (m) {
        const [, lead, key, colon, rest] = m;
        return `${escapeHtml(lead)}<span class="hl-k">${escapeHtml(key)}</span>${escapeHtml(colon)}${highlightYamlValue(rest)}`;
      }
      return escapeHtml(line);
    })
    .join("\n");
}

function highlightYamlValue(rest) {
  if (!rest.trim()) return escapeHtml(rest);
  const trimmed = rest.trim();
  if (/^["'].*["']$/.test(trimmed)) {
    return (
      escapeHtml(rest.replace(trimmed, "")) + `<span class="hl-s">${escapeHtml(trimmed)}</span>`
    );
  }
  if (/^(true|false|null|~)$/i.test(trimmed)) {
    return (
      escapeHtml(rest.replace(trimmed, "")) + `<span class="hl-m">${escapeHtml(trimmed)}</span>`
    );
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return (
      escapeHtml(rest.replace(trimmed, "")) + `<span class="hl-n">${escapeHtml(trimmed)}</span>`
    );
  }
  return escapeHtml(rest);
}
