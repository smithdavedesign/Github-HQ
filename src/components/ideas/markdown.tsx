import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeUrl } from '@/lib/ideas/idea-utils'

/**
 * The idea record's markdown (research, PRD, roadmap, review), written by models from public
 * research: raw HTML is never rendered (react-markdown's default), links open in a new tab with
 * nofollow, only http(s) links are kept, and images show as links rather than loading.
 */
const components: Components = {
  h1: ({ children }) => <h2 className="text-xl font-semibold tracking-tight mt-6 first:mt-0 mb-3">{children}</h2>,
  h2: ({ children }) => <h3 className="text-lg font-semibold mt-6 first:mt-0 mb-2 pb-1 border-b">{children}</h3>,
  h3: ({ children }) => <h4 className="text-base font-semibold mt-5 mb-2">{children}</h4>,
  h4: ({ children }) => <h5 className="text-sm font-semibold mt-4 mb-1.5">{children}</h5>,
  p: ({ children }) => <p className="text-sm leading-relaxed my-2.5">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-2.5 space-y-1 text-sm leading-relaxed">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-2.5 space-y-1 text-sm leading-relaxed">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 [&>p]:my-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 my-3 text-muted-foreground italic">{children}</blockquote>,
  hr: () => <hr className="my-5 border-border" />,
  a: ({ href, children }) => {
    const url = safeUrl(href)
    return url
      ? <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2 break-words hover:opacity-80">{children}</a>
      : <span>{children}</span>
  },
  img: ({ src, alt }) => {
    const url = safeUrl(typeof src === 'string' ? src : null)
    return url ? <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline">{alt || 'image'}</a> : null
  },
  code: ({ className, children }) => className
    ? <code className={`${className} font-mono text-xs`}>{children}</code>
    : <code className="font-mono text-[0.8em] bg-muted rounded px-1 py-0.5">{children}</code>,
  pre: ({ children }) => <pre className="bg-muted rounded-lg p-3 my-3 overflow-x-auto text-xs leading-relaxed">{children}</pre>,
  table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full text-sm border-collapse">{children}</table></div>,
  th: ({ children }) => <th className="text-left font-medium border-b px-2 py-1.5 bg-muted/50">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1.5 align-top">{children}</td>,
  input: ({ checked }) => <input type="checkbox" checked={!!checked} readOnly disabled className="mr-1.5 align-middle" />,
}

export function IdeaMarkdown({ children }: { children: string }) {
  return (
    <div className="max-w-none break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{children}</Markdown>
    </div>
  )
}
