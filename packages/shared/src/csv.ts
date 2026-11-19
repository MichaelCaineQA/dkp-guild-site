/**
 * CSV-экспорт статистики (#223, план 2.8): единый конструктор для всех
 * таблиц этапа. Разделитель «;» (русская локаль Excel), UTF-8 c BOM
 * добавляет сервер, кириллица/кавычки/переносы экранируются по RFC 4180,
 * значения с началом формулы (+ - = @ таб CR) префиксируются апострофом,
 * чтобы пользовательский текст не выполнялся табличным редактором.
 */

export const CSV_SEPARATOR = ';';

/** Ячейка CSV: экранирование и защита от выполнения формул. */
export function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Защита от инъекции формул — только для строк (числа-суммы доверены):
  // префикс-апостроф нейтрализует =+@- и пробельные начала пользовательского текста.
  const guarded = typeof value === 'string' && /^[\t\r =+\-@]/.test(raw) ? `'${raw}` : raw;
  const needQuoting =
    guarded.includes(CSV_SEPARATOR) ||
    guarded.includes('"') ||
    guarded.includes('\n') ||
    guarded.includes('\r');
  const normalized = needQuoting ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  // Точка с запятой в неквоченном значении невозможна; возвращаем как есть.
  return normalized;
}

/** Строка таблицы CSV. */
export function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(CSV_SEPARATOR);
}

type CsvCell = string | number | null | undefined;

/**
 * Полный файл: мета-строки «# …» (период, фильтры, часовой пояс, дата
 * среза) + пустая строка + таблица с заголовком. Переносы строк CRLF
 * по RFC 4180.
 */
export function toCsvFile(meta: string[], header: CsvCell[], rows: CsvCell[][]): string {
  const lines = [
    ...meta.map((line) => `# ${line}`),
    '',
    csvRow(header),
    ...rows.map((row) => csvRow(row)),
  ];
  return lines.join('\r\n');
}

/** Дата-время операции/среза в читаемом виде Москвы (UTC+3, фикс. зона). */
export function csvMoscowDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const moscow = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(moscow.getUTCDate())}.${pad(moscow.getUTCMonth() + 1)}.${moscow.getUTCFullYear()} ${pad(moscow.getUTCHours())}:${pad(moscow.getUTCMinutes())}`;
}

/** Календарная дата периода «01.11.2026». */
export function csvMoscowDate(value: string | Date): string {
  return csvMoscowDateTime(value).slice(0, 10);
}

/**
 * Процент для CSV: «37,5»/«0»/пусто для null. Возвращаем число-строку без
 * знака %: единица указана в заголовке столбца.
 */
export function csvPercent(value: number | null): string {
  if (value === null) return '';
  return (Math.round(value * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

/** Подпись фильтров выгрузки: «КП: Альфа; Тип ивента: Гильдбосс». */
export function csvFiltersLabel(query: {
  kpId?: string;
  packId?: string;
  eventTypeId?: string;
  mode?: string;
}): string {
  const parts: string[] = [];
  if (query.kpId) parts.push(`КП ${query.kpId}`);
  if (query.packId) parts.push(`Пак ${query.packId}`);
  if (query.eventTypeId) parts.push(`Тип ивента ${query.eventTypeId}`);
  if (query.mode) parts.push(query.mode === 'PVE' ? 'PvE' : 'PvP');
  return parts.length > 0 ? parts.join('; ') : 'нет';
}
