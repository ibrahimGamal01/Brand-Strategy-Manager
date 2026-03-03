"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

export function ChatMarkdown({
  content,
  className,
  compact = false,
}: {
  content: string;
  className?: string;
  compact?: boolean;
}) {
  const proseClass = compact
    ? "max-w-none text-sm leading-6 text-zinc-800 [&_h1]:mb-1.5 [&_h1]:mt-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2.5 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-zinc-200 [&_pre]:bg-zinc-950 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_table]:w-full [&_table]:text-left [&_thead]:bg-zinc-50"
    : "max-w-none text-[15px] leading-7 text-zinc-800 [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-zinc-200 [&_pre]:bg-zinc-950 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:w-full [&_table]:text-left [&_thead]:bg-zinc-50";

  return (
    <div className={["select-text", className, proseClass].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: (props) => (
            <a {...props} target="_blank" rel="noreferrer" className="text-zinc-900 underline underline-offset-4" />
          ),
          table: (props) => <table {...props} className="w-full table-auto border-collapse text-sm" />,
          th: (props) => <th {...props} className="border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-left font-semibold" />,
          td: (props) => <td {...props} className="border border-zinc-200 px-2 py-1.5 align-top" />,
          blockquote: (props) => (
            <blockquote {...props} className="border-l-2 border-zinc-300 pl-3 text-zinc-700" />
          ),
          hr: (props) => <hr {...props} className="my-5 border-zinc-200" />,
        }}
      >
        {String(content || "")}
      </ReactMarkdown>
    </div>
  );
}
