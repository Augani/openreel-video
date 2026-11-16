import { Button as ShadcnButton } from "@openreel/ui";
import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { isValidElement, useState } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "@/icons/lucide-compat";

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function CodeBlock({ children }: ComponentPropsWithoutRef<"pre">): JSX.Element {
  const [copied, setCopied] = useState(false);
  const code = nodeText(children).replace(/\n$/, "");

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access may be unavailable in an embedded or insecure context.
    }
  };

  return (
    <div className="group/code relative my-2 min-w-0">
      <pre
        className="max-w-full overflow-x-auto rounded-lg border border-border bg-bg-2 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-fg"
      >
        {children}
      </pre>
      <ShadcnButton variant="ghost" size="sm"
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? "Copied code" : "Copy code"}
        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md border p-0 [&_svg]:size-[11px] border-border bg-bg-1/90 text-fg-muted opacity-0 shadow-sm transition hover:text-fg focus:opacity-100 group-hover/code:opacity-100"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </ShadcnButton>
    </div>
  );
}

const components: Components = {
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-1.5 mt-3 text-[15px] font-semibold text-fg">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-[14px] font-semibold text-fg">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-[13px] font-semibold text-fg">{children}</h3>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-fg-muted">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-fg-muted">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-accent/50 pl-3 text-fg-2">{children}</blockquote>
  ),
  a: ({ children, href, title }) => (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {children}
    </a>
  ),
  pre: CodeBlock,
  code: ({ children, className }) => {
    const block = className?.startsWith("language-") || nodeText(children).includes("\n");
    return (
      <code
        className={
          block
            ? `${className ?? ""} font-mono`
            : "rounded bg-bg-2 px-1 py-0.5 font-mono text-[0.9em] text-fg"
        }
      >
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <table className="my-2 min-w-full border-collapse text-left text-[11px]">{children}</table>
  ),
  thead: ({ children }) => <thead className="bg-bg-2 text-fg">{children}</thead>,
  th: ({ children }) => <th className="border border-border px-2 py-1.5 font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1.5 align-top">{children}</td>,
  hr: () => <hr className="my-3 border-border" />,
  img: ({ alt, src, title }) => (
    <img
      src={src}
      alt={alt ?? ""}
      title={title}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="my-2 max-h-64 max-w-full rounded-lg border border-border object-contain"
    />
  ),
};

export function MarkdownMessage({ text }: { text: string }): JSX.Element {
  return (
    <div className="min-w-0 break-words text-[13px] leading-relaxed text-fg [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={defaultUrlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
