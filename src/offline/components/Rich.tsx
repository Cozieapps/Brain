import type { ReactNode } from "react";

/** Small, safe markdown subset: paragraphs, lists and bold. No HTML is ever injected. */
export function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length}>{items}</ol>
      ) : (
        <ul key={blocks.length}>{items}</ul>
      ),
    );
    list = null;
  };
  for (const para of text.split(/\n{2,}/)) {
    for (const line of para.split("\n")) {
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        const ordered = Boolean(numbered);
        if (list && list.ordered !== ordered) flush();
        list ??= { ordered, items: [] };
        list.items.push((bullet ?? numbered)![1]);
      } else if (line.trim()) {
        flush();
        blocks.push(
          <p key={blocks.length}>{inline(line.replace(/^#{1,6}\s+/, ""))}</p>,
        );
      }
    }
    flush();
  }
  return <>{blocks}</>;
}

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part.replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,!?])/g, "$1$2")
      ),
    );
}
