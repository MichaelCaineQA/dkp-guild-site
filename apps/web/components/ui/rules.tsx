import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function RulesLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-4">{children}</div>;
}

/** Без raw HTML; стандартная URL-фильтрация react-markdown сохранена. */
export function RulesMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words leading-relaxed [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:my-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:text-lg [&_h3]:font-semibold [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-accent [&_a]:underline [&_img]:max-h-96 [&_img]:max-w-full [&_img]:object-contain [&_blockquote]:border-l-4 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-muted [&_pre]:p-3 [&_th]:border [&_th]:border-line [&_th]:p-2 [&_td]:border [&_td]:border-line [&_td]:p-2">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

export function RulesEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      Текст правил (Markdown, до 20 000 символов)
      <textarea
        required
        aria-label="Текст правил"
        maxLength={20_000}
        rows={14}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 rounded-lg border border-line bg-surface p-3 font-mono text-primary focus:border-accent focus:outline-none"
      />
    </label>
  );
}
