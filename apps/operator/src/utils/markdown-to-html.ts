const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const PLACEHOLDER_OPEN = "";
const PLACEHOLDER_CLOSE = "";
const PLACEHOLDER_RE = /P(\d+)/g;
const SENTINEL_RE = /[]/g;

const stripSentinels = (s: string): string => s.replace(SENTINEL_RE, "");

const applyEmphasis = (text: string): string => {
  let s = text;
  s = s.replaceAll(/\*\*([^*\n<>]+?)\*\*/g, "<b>$1</b>");
  s = s.replaceAll(/__([^_\n<>]+?)__/g, "<b>$1</b>");
  s = s.replaceAll(/~~([^~\n<>]+?)~~/g, "<s>$1</s>");
  s = s.replaceAll(/(?<![*\w])\*(?!\*)([^*\n<>]+?)\*(?!\*)/g, "<i>$1</i>");
  s = s.replaceAll(/(?<![_\w])_(?!_)([^_\n<>]+?)_(?!_)/g, "<i>$1</i>");
  return s;
};

const inlineConvert = (text: string, protectedSegments: string[]): string => {
  const protect = (segment: string): string => {
    const idx = protectedSegments.length;
    protectedSegments.push(segment);
    return `${PLACEHOLDER_OPEN}P${String(idx)}${PLACEHOLDER_CLOSE}`;
  };

  let s = text;

  s = s.replaceAll(/`([^`\n]+)`/g, (_m, content: string) =>
    protect(`<code>${content}</code>`)
  );

  s = applyEmphasis(s);

  return s;
};

const restoreProtected = (s: string, protectedSegments: string[]): string => {
  let result = s;
  while (PLACEHOLDER_RE.test(result)) {
    PLACEHOLDER_RE.lastIndex = 0;
    result = result.replace(PLACEHOLDER_RE, (_m, idx: string) => {
      const segment = protectedSegments[Number(idx)];
      if (segment === undefined) {
        throw new Error(`No protected segment for placeholder index ${idx}`);
      }
      return segment;
    });
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
    if (line === undefined) {
      break;
    }

    const fenceStart = /^```([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fenceStart) {
      const closeOffset = lines
        .slice(i + 1)
        .findIndex((l) => /^```\s*$/.test(l));
      if (closeOffset !== -1) {
        const j = i + 1 + closeOffset;
        const lang = fenceStart[1];
        const content = lines.slice(i + 1, j).join("\n");
        const langAttr =
          lang !== undefined && lang !== "" ? ` class="language-${lang}"` : "";
        out.push(`<pre><code${langAttr}>${escapeHtml(content)}</code></pre>`);
        i = j + 1;
        continue;
      }
    }

    const headingText = /^(#{1,6})\s+(.*)$/.exec(line)?.[2];
    if (headingText !== undefined) {
      out.push(
        `<b>${inlineConvert(escapeHtml(headingText), protectedSegments)}</b>`
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
      let quoted = lines[i];
      while (quoted !== undefined && quoted.startsWith(">")) {
        const stripped = quoted.replace(/^>\s?/, "");
        buf.push(inlineConvert(escapeHtml(stripped), protectedSegments));
        i++;
        quoted = lines[i];
      }
      out.push(`<blockquote>${buf.join("\n")}</blockquote>`);
      continue;
    }

    const listItem = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line)?.[1];
    if (listItem !== undefined) {
      out.push(`• ${inlineConvert(escapeHtml(listItem), protectedSegments)}`);
      i++;
      continue;
    }

    out.push(inlineConvert(escapeHtml(line), protectedSegments));
    i++;
  }

  return restoreProtected(out.join("\n"), protectedSegments);
};

export { markdownToTelegramHtml };
