const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const PLACEHOLDER_OPEN = "";
const PLACEHOLDER_CLOSE = "";
const PLACEHOLDER_RE = /P(\d+)/g;
const SENTINEL_RE = /[]/g;

const stripSentinels = (s: string): string => s.replace(SENTINEL_RE, "");

const applyEmphasis = (text: string): string => {
  let s = text;
  s = s.replace(/\*\*([^*\n<>]+?)\*\*/g, "<b>$1</b>");
  s = s.replace(/__([^_\n<>]+?)__/g, "<b>$1</b>");
  s = s.replace(/~~([^~\n<>]+?)~~/g, "<s>$1</s>");
  s = s.replace(/(?<![*\w])\*(?!\*)([^*\n<>]+?)\*(?!\*)/g, "<i>$1</i>");
  s = s.replace(/(?<![_\w])_(?!_)([^_\n<>]+?)_(?!_)/g, "<i>$1</i>");
  return s;
};

const inlineConvert = (text: string, protectedSegments: string[]): string => {
  const protect = (segment: string): string => {
    const idx = protectedSegments.length;
    protectedSegments.push(segment);
    return `${PLACEHOLDER_OPEN}P${String(idx)}${PLACEHOLDER_CLOSE}`;
  };

  let s = text;

  s = s.replace(/`([^`\n]+)`/g, (_m, content: string) =>
    protect(`<code>${content}</code>`)
  );

  s = applyEmphasis(s);

  return s;
};

const restoreProtected = (s: string, protectedSegments: string[]): string => {
  let result = s;
  while (PLACEHOLDER_RE.test(result)) {
    PLACEHOLDER_RE.lastIndex = 0;
    result = result.replace(
      PLACEHOLDER_RE,
      (_m, idx: string) => protectedSegments[Number(idx)]
    );
  }
  return result;
};

const markdownToTelegramHtml = (md: string): string => {
  if (md === "") {
    return "";
  }

  const sanitized = stripSentinels(md);
  const lines = sanitized.split("\n");
  const out: string[] = [];
  const protectedSegments: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fenceStart = /^```([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fenceStart) {
      let j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        j++;
      }
      if (j < lines.length) {
        const lang = fenceStart[1];
        const content = lines.slice(i + 1, j).join("\n");
        const langAttr = lang ? ` class="language-${lang}"` : "";
        out.push(`<pre><code${langAttr}>${escapeHtml(content)}</code></pre>`);
        i = j + 1;
        continue;
      }
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(
        `<b>${inlineConvert(escapeHtml(heading[2]), protectedSegments)}</b>`
      );
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      out.push("");
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        const stripped = lines[i].replace(/^>\s?/, "");
        buf.push(inlineConvert(escapeHtml(stripped), protectedSegments));
        i++;
      }
      out.push(`<blockquote>${buf.join("\n")}</blockquote>`);
      continue;
    }

    const list = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (list) {
      out.push(`• ${inlineConvert(escapeHtml(list[1]), protectedSegments)}`);
      i++;
      continue;
    }

    out.push(inlineConvert(escapeHtml(line), protectedSegments));
    i++;
  }

  return restoreProtected(out.join("\n"), protectedSegments);
};

export { markdownToTelegramHtml };
