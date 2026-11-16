import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

/** Бейдж — короткая пометка: роль в бою, ранг, статус. tone задаёт семантику. */
export function Badge({
  tone = 'neutral',
  className = '',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'warning' }) {
  const tones = {
    neutral: 'border-line bg-surface-muted text-secondary',
    accent: 'border-accent/25 bg-accent-soft text-accent',
    success: 'border-success/25 bg-success-soft text-success',
    danger: 'border-danger/25 bg-danger-soft text-danger',
    warning: 'border-warning/25 bg-warning-soft text-warning',
  };
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-md border px-3 py-1 text-sm font-semibold leading-tight tracking-wide ${tones[tone]} ${className}`}
      {...props}
    />
  );}

interface TableProps {
  children: ReactNode;
  /** Применяется к прокручиваемой обёртке (отступы вокруг таблицы). */
  className?: string;
}

function TableBase({ children, className = '' }: TableProps) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-sm">{children}</table>
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
