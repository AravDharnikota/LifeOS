import { Fragment, type ReactNode } from "react";

type Block = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] };

/** Plain text with newline paragraphs and "- " bullets. Nothing else is interpreted. `trailing` is placed after the last character, so a cursor follows the text. */
export function AgentText({ text, trailing }: { text: string; trailing?: ReactNode }) {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1] ?? "");
      else blocks.push({ kind: "ul", items: [bullet[1] ?? ""] });
    } else if (!line.trim()) {
      if (last && !(last.kind === "p" && last.lines.length === 0)) blocks.push({ kind: "p", lines: [] });
    } else if (last?.kind === "p") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }
  const shown = blocks.filter((b) => b.kind === "ul" || b.lines.length > 0);
  if (shown.length === 0) return trailing ? <p>{trailing}</p> : null;
  return (
    <>
      {shown.map((b, i) => {
        const tail = i === shown.length - 1 ? trailing : null;
        return b.kind === "ul" ? (
          <ul key={i} className="my-1 pl-5 list-disc marker:text-term-fg-faint space-y-0.5">
            {b.items.map((it, j) => (
              <li key={j}>
                {it}
                {j === b.items.length - 1 && tail}
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className={i > 0 ? "mt-2" : undefined}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {l}
              </Fragment>
            ))}
            {tail}
          </p>
        );
      })}
    </>
  );
}
