"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="ai-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          table: ({ node: _node, ...props }) => (
            <div className="overflow-x-auto" role="region" aria-label="Data table" tabIndex={0}>
              <table {...props} />
            </div>
          ),
          th: ({ node: _node, ...props }) => <th scope="col" {...props} />,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
