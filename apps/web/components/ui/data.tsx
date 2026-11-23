'use client';
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type ThHTMLAttributes,
  type TdHTMLAttributes,
} from 'react';

/** Бейдж — короткая пометка: роль в бою, ранг, статус. tone задаёт семантику. */
export function Badge({
  tone = 'neutral',
  className = '',
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning';
}) {
  const tones = {
    neutral: 'bg-surface-muted text-secondary',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    danger: 'bg-danger-soft text-danger',
    warning: 'bg-warning-soft text-warning',
  };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    />
  );
}

interface TableProps {
  children: ReactNode;
  /** Применяется к прокручиваемой обёртке (отступы вокруг таблицы). */
  className?: string;
}

/**
 * Таблица шире карточки прокручивается вбок. На узком экране это не видно
 * заранее, поэтому у правого края, пока есть скрытые столбцы, показан
 * постепенный уход фона (этап 5, мобильная доводка).
 */
function TableBase({ children, className = '' }: TableProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [hasHidden, setHasHidden] = useState(false);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const update = () => {
      const rest = node.scrollWidth - node.clientWidth - node.scrollLeft;
      setHasHidden(rest > 1);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node);
    for (const child of node.children) observer?.observe(child);
    node.addEventListener('scroll', update, { passive: true });
    return () => {
      observer?.disconnect();
      node.removeEventListener('scroll', update);
    };
  }, []);

  return (
    <div className="relative min-w-0">
      <div ref={scroller} className={`overflow-x-auto ${className}`}>
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
      {hasHidden && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-neutral-500/25 to-transparent"
        />
      )}
    </div>
  );
}

function Th({ className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`border-b border-line px-3 py-2 text-left font-semibold text-secondary ${className}`}
      {...props}
    />
  );
}

function Td({ className = '', ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`border-b border-line px-3 py-2 text-primary ${className}`} {...props} />;
}

/** Строка с onClick — кликабельная (карточка члена, лот). */
function Row({ className = '', ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`cursor-pointer hover:bg-accent-soft ${className}`} {...props} />;
}

/** Таблица данных. Ячейки-заголовки и ячейки — Table.Th / Table.Td. */
export const Table = Object.assign(TableBase, { Th, Td, Row });
