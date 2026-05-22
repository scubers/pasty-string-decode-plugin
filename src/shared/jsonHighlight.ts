const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function span(type: string, text: string): string {
  return `<span class="jh-${type}">${escHtml(text)}</span>`;
}

function tokenize(text: string): Array<{ type: string; raw: string }> {
  const tokens: Array<{ type: string; raw: string }> = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      tokens.push({ type: "whitespace", raw: text.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          j += 1;
          break;
        }
        j += 1;
      }
      const raw = text.slice(i, j);
      let peek = j;
      while (peek < text.length && /\s/.test(text[peek])) peek += 1;
      tokens.push({ type: text[peek] === ":" ? "key" : "string", raw });
      i = j;
      continue;
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let j = i + 1;
      while (j < text.length && /[0-9eE+\-.]/.test(text[j])) j += 1;
      tokens.push({ type: "number", raw: text.slice(i, j) });
      i = j;
      continue;
    }

    if (text.startsWith("true", i) || text.startsWith("false", i)) {
      const raw = text.startsWith("true", i) ? "true" : "false";
      tokens.push({ type: "bool", raw });
      i += raw.length;
      continue;
    }

    if (text.startsWith("null", i)) {
      tokens.push({ type: "null", raw: "null" });
      i += 4;
      continue;
    }

    tokens.push({ type: "punct", raw: ch });
    i += 1;
  }

  return tokens;
}

export function highlightJson(text: string): string {
  try {
    JSON.parse(text);
  } catch {
    return escHtml(text);
  }

  return tokenize(text)
    .map((token) => (token.type === "whitespace" ? token.raw : span(token.type, token.raw)))
    .join("");
}
