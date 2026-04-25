import { describe, expect, it } from "vitest";

import { markdownToTelegramHtml } from "./markdown-to-html";
import { splitMessage } from "./message";

describe("markdownToTelegramHtml — happy path", () => {
  it("returns empty string for empty input", () => {
    expect(markdownToTelegramHtml("")).toBe("");
  });

  it("passes plain text through unchanged", () => {
    expect(markdownToTelegramHtml("hello world")).toBe("hello world");
  });

  it("converts h1 to bold", () => {
    expect(markdownToTelegramHtml("# Title")).toBe("<b>Title</b>");
  });

  it("converts h2 to bold", () => {
    expect(markdownToTelegramHtml("## Subtitle")).toBe("<b>Subtitle</b>");
  });

  it("converts h6 to bold", () => {
    expect(markdownToTelegramHtml("###### Smallest")).toBe("<b>Smallest</b>");
  });

  it("converts ** bold **", () => {
    expect(markdownToTelegramHtml("a **bold** b")).toBe("a <b>bold</b> b");
  });

  it("converts __ bold __", () => {
    expect(markdownToTelegramHtml("a __bold__ b")).toBe("a <b>bold</b> b");
  });

  it("converts *italic*", () => {
    expect(markdownToTelegramHtml("a *italic* b")).toBe("a <i>italic</i> b");
  });

  it("converts _italic_", () => {
    expect(markdownToTelegramHtml("a _italic_ b")).toBe("a <i>italic</i> b");
  });

  it("converts ~~strike~~", () => {
    expect(markdownToTelegramHtml("a ~~strike~~ b")).toBe("a <s>strike</s> b");
  });

  it("converts inline code", () => {
    expect(markdownToTelegramHtml("a `code` b")).toBe("a <code>code</code> b");
  });

  it("converts fenced code without language", () => {
    expect(markdownToTelegramHtml("```\nfoo\nbar\n```")).toBe(
      "<pre><code>foo\nbar</code></pre>"
    );
  });

  it("converts fenced code with language", () => {
    expect(markdownToTelegramHtml("```js\nconst x = 1;\n```")).toBe(
      '<pre><code class="language-js">const x = 1;</code></pre>'
    );
  });

  it("converts blockquote across multiple lines", () => {
    expect(markdownToTelegramHtml("> first\n> second")).toBe(
      "<blockquote>first\nsecond</blockquote>"
    );
  });

  it("converts bullet list (-) to bullet character", () => {
    expect(markdownToTelegramHtml("- one\n- two")).toBe("• one\n• two");
  });

  it("converts bullet list (*) to bullet character", () => {
    expect(markdownToTelegramHtml("* one\n* two")).toBe("• one\n• two");
  });

  it("converts numbered list to bullet character", () => {
    expect(markdownToTelegramHtml("1. one\n2. two")).toBe("• one\n• two");
  });

  it("preserves multi-line paragraphs", () => {
    expect(markdownToTelegramHtml("line1\nline2")).toBe("line1\nline2");
  });

  it("converts horizontal rule to blank line", () => {
    expect(markdownToTelegramHtml("a\n---\nb")).toBe("a\n\nb");
  });
});

describe("markdownToTelegramHtml — escaping", () => {
  it("escapes < in plain text", () => {
    expect(markdownToTelegramHtml("a < b")).toBe("a &lt; b");
  });

  it("escapes > in plain text", () => {
    expect(markdownToTelegramHtml("a >b")).toBe("a &gt;b");
  });

  it("escapes & in plain text", () => {
    expect(markdownToTelegramHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes raw <script> tags as literal text", () => {
    expect(markdownToTelegramHtml("hello <script>alert(1)</script>")).toBe(
      "hello &lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  it("escapes raw <div> tags as literal text", () => {
    expect(markdownToTelegramHtml("<div>x</div>")).toBe(
      "&lt;div&gt;x&lt;/div&gt;"
    );
  });

  it("escapes special chars inside fenced code", () => {
    expect(markdownToTelegramHtml("```\n<x> & y\n```")).toBe(
      "<pre><code>&lt;x&gt; &amp; y</code></pre>"
    );
  });
});

describe("markdownToTelegramHtml — malformed input (fail-soft)", () => {
  it("leaves unmatched ** as literal", () => {
    expect(markdownToTelegramHtml("**bold no closer")).toBe("**bold no closer");
  });

  it("leaves single unmatched backtick as literal", () => {
    expect(markdownToTelegramHtml("`code no closer")).toBe("`code no closer");
  });

  it("leaves unclosed fenced code as literal", () => {
    const out = markdownToTelegramHtml("```\nfoo\nbar");
    expect(out).not.toContain("<pre>");
    expect(out).toContain("```");
    expect(out).toContain("foo");
  });

  it("does not produce broken tags for nested ***x***", () => {
    const out = markdownToTelegramHtml("***x***");
    expect(countSubstr(out, "<b>")).toBe(countSubstr(out, "</b>"));
    expect(countSubstr(out, "<i>")).toBe(countSubstr(out, "</i>"));
  });

  it("does not produce broken tags for overlapping **a *b** c*", () => {
    const out = markdownToTelegramHtml("**a *b** c*");
    expect(countSubstr(out, "<b>")).toBe(countSubstr(out, "</b>"));
    expect(countSubstr(out, "<i>")).toBe(countSubstr(out, "</i>"));
  });

  it("does not treat asterisks adjacent to word chars as italic", () => {
    expect(markdownToTelegramHtml("a*b*c")).toBe("a*b*c");
  });

  it("does not interpret markers inside fenced code", () => {
    expect(
      markdownToTelegramHtml("```\n**not bold** and `not code`\n```")
    ).toBe("<pre><code>**not bold** and `not code`</code></pre>");
  });

  it("produces balanced tags for long input around 4096 chars", () => {
    const filler = "word ".repeat(800);
    const md = `**bold** ${filler} \`code\``;
    const out = markdownToTelegramHtml(md);
    expect(out.length).toBeGreaterThan(4000);
    expect(countSubstr(out, "<b>")).toBe(countSubstr(out, "</b>"));
    expect(countSubstr(out, "<code>")).toBe(countSubstr(out, "</code>"));
  });
});

describe("markdownToTelegramHtml — protect inline code from later passes", () => {
  it("keeps emphasis markers literal inside inline code", () => {
    expect(markdownToTelegramHtml("`**x**`")).toBe("<code>**x**</code>");
  });

  it("keeps link syntax literal inside inline code", () => {
    expect(markdownToTelegramHtml("`[x](https://e.com)`")).toBe(
      "<code>[x](https://e.com)</code>"
    );
  });

  it("keeps backticks literal inside inline code (already-escaped)", () => {
    expect(markdownToTelegramHtml("`a > b`")).toBe("<code>a &gt; b</code>");
  });

  it("strips placeholder sentinels from input to prevent collision", () => {
    const malicious = `P0 some text`;
    const out = markdownToTelegramHtml(malicious);
    expect(out).not.toContain("");
    expect(out).not.toContain("");
    expect(out).toContain("P0");
    expect(out).toContain("some text");
  });
});

describe("markdownToTelegramHtml — splitMessage + convert pipeline", () => {
  it("produces balanced HTML for every chunk when reply > 4096 chars", () => {
    const longReply = [
      "# Title",
      "",
      "**bold paragraph 1** with `code`.",
      "",
      "Some filler. ".repeat(400),
      "",
      "**bold paragraph 2**",
      "",
      "More filler. ".repeat(400),
      "",
      "Final paragraph with **bold** and *italic*.",
    ].join("\n");
    expect(longReply.length).toBeGreaterThan(4096);

    const chunks = splitMessage(longReply);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      const html = markdownToTelegramHtml(chunk);
      expect(countSubstr(html, "<b>")).toBe(countSubstr(html, "</b>"));
      expect(countSubstr(html, "<i>")).toBe(countSubstr(html, "</i>"));
      expect(countSubstr(html, "<code>")).toBe(countSubstr(html, "</code>"));
      expect(countSubstr(html, "<pre>")).toBe(countSubstr(html, "</pre>"));
      expect(countSubstr(html, "<blockquote>")).toBe(
        countSubstr(html, "</blockquote>")
      );
    }
  });

  it("produces balanced HTML when split lands inside a fenced code block", () => {
    const codeFence =
      "```\n" + "code line\n".repeat(500) + "```\n\nFollow-up text.";
    expect(codeFence.length).toBeGreaterThan(4096);

    const chunks = splitMessage(codeFence);
    for (const chunk of chunks) {
      const html = markdownToTelegramHtml(chunk);
      expect(countSubstr(html, "<pre>")).toBe(countSubstr(html, "</pre>"));
      expect(countSubstr(html, "<code")).toBe(countSubstr(html, "</code>"));
    }
  });
});

const countSubstr = (haystack: string, needle: string): number => {
  let n = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) {
      return n;
    }
    n++;
    from = idx + needle.length;
  }
};
