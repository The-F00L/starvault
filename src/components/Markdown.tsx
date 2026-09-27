import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/** Render GitHub README markdown, resolving relative links/images against the repo. */
export function Markdown({ source, fullName, branch }: { source: string; fullName: string; branch: string }) {
  const resolve = (url: string, key: string) => {
    if (/^(https?:|mailto:|#)/i.test(url)) return defaultUrlTransform(url);
    const path = url.replace(/^\.?\//, "");
    const base = key === "src" ? `https://raw.githubusercontent.com/${fullName}/${branch}/` : `https://github.com/${fullName}/blob/${branch}/`;
    return defaultUrlTransform(base + path);
  };
  return (
    <div className="prose prose-invert max-w-none prose-headings:tracking-tight prose-a:text-secondary prose-code:text-tertiary-container prose-code:before:content-none prose-code:after:content-none prose-pre:bg-surface-container-lowest prose-pre:border prose-pre:border-surface-container-highest prose-img:inline prose-img:my-0 prose-hr:border-surface-container-highest">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        urlTransform={resolve}
        components={{ a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
