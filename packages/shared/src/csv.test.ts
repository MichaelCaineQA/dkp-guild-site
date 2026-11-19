import { describe, expect, it } from 'vitest';
import { csvCell, csvFiltersLabel, csvMoscowDateTime, csvPercent, csvRow, toCsvFile } from './csv';

describe('csvCell', () => {
  it('экранирует разделитель, кавычки и переносы по RFC 4180', () => {
    expect(csvCell('обычное')).toBe('обычное');
    expect(csvCell('а;б')).toBe('"а;б"');
    expect(csvCell('кавы"чки')).toBe('"кавы""чки"');
    expect(csvCell('строка1\nстрока2')).toBe('"строка1\nстрока2"');
  });

  it('null и undefined становятся пустыми ячейками', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvRow(['а', null, 5])).toBe('а;;5');
  });

  it('текст со знаком формулы не выполняется редактором', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('\tTAB')).toBe("'\tTAB");
    // Отрицательные суммы ДКП приходят числами и не префиксуются.
    expect(csvCell(-40)).toBe('-40');
  });
});

describe('toCsvFile', () => {
  it('мета-строки с #, пустая строка, заголовок и строки CRLF', () => {
    const file = toCsvFile(
      ['Период: 01.11.2026–30.11.2026'],
      ['Игрок', 'Отметки'],
      [
        ['Аня', 4],
        ['Борис;мл.', 2],
      ],
    );
    expect(file.split('\r\n')).toEqual([
      '# Период: 01.11.2026–30.11.2026',
      '',
      'Игрок;Отметки',
      'Аня;4',
      '"Борис;мл.";2',
    ]);
  });
});

describe('форматы', () => {
  it('дата-время Москвы из ISO', () => {
    expect(csvMoscowDateTime('2026-11-30T21:00:00.000Z')).toBe('01.12.2026 00:00');
    expect(csvMoscowDateTime('2026-12-05T18:30:00.000Z')).toBe('05.12.2026 21:30');
  });

  it('проценты: запятая, округление до десятой, null — пусто', () => {
    expect(csvPercent(37.549)).toBe('37,5');
    expect(csvPercent(100)).toBe('100');
    expect(csvPercent(0)).toBe('0');
    expect(csvPercent(null)).toBe('');
  });

  it('подпись применённых фильтров', () => {
    expect(csvFiltersLabel({})).toBe('нет');
    expect(csvFiltersLabel({ mode: 'PVE' })).toBe('PvE');
    expect(csvFiltersLabel({ kpId: 'k1', eventTypeId: 't1' })).toBe('КП k1; Тип ивента t1');
  });
});
