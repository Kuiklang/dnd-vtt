import ReactMarkdown from "react-markdown";

/**
 * Renders journal Markdown. react-markdown never renders raw HTML (no rehype-raw), so
 * user text can't inject markup or scripts; links open in a new tab without an opener.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="journal-md space-y-2 text-sm leading-relaxed text-parchment-200">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const safe = href && /^(https?:|mailto:|#|\/)/i.test(href) ? href : undefined;
            return (
              <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="text-gold-400 underline">
                {children}
              </a>
            );
          },
          img: ({ alt }) => <span className="text-parchment-500">[{alt || "image"}]</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
