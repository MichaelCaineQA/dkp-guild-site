'use client';

/**
 * Вкладки-переключатели внутри экрана: активный пункт подсвечен, список
 * прокручивается горизонтально на узком экране, фокус и выбор — стрелками
 * влево/вправо (roving tabindex). Содержимое панели рендерит экран
 * с role="tabpanel" и aria-labelledby по id вкладки.
 */
export interface TabItem<K extends string> {
  key: K;
  label: string;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** aria-label для списка вкладок. */
  label: string;
}) {
  const move = (step: 1 | -1) => {
    const index = items.findIndex((item) => item.key === value);
    const next = items[(index + step + items.length) % items.length];
    if (!next) return;
    onChange(next.key);
    requestAnimationFrame(() => {
      document.getElementById(`tab-${next.key}`)?.focus();
    });
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-4 flex gap-1 overflow-x-auto pb-1"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            id={`tab-${item.key}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.key)}
            className={`min-h-11 whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-medium md:min-h-0 ${
              active
                ? 'bg-accent text-accent-contrast'
                : 'border border-line bg-surface text-primary hover:bg-surface-muted'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
