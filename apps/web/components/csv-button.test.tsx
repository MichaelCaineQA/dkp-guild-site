import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CsvButton } from './ui/charts';

/** Состояния скачивания CSV (#223): файл создаётся только успешным ответом. */

const clickUrls: string[] = [];
const fetchMock = vi.fn();

vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: vi.fn(() => 'blob:mock'),
  revokeObjectURL: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  clickUrls.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickUrls.push(this.href);
  });
});
afterEach(cleanup);

function csvResponse(body = 'a;b', filename = 'statistics-top.csv') {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

it('успешное скачивание: blob из ответа с серверным именем файла', async () => {
  fetchMock.mockResolvedValue(csvResponse());
  render(<CsvButton path="/statistics/export.csv?table=top" label="топ" />);
  fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV: топ' }));
  await waitFor(() => expect(clickUrls).toEqual(['blob:mock']));
  expect(fetchMock).toHaveBeenCalledWith('/api/statistics/export.csv?table=top', {
    credentials: 'include',
  });
  expect(screen.queryByText('Не удалось скачать CSV')).toBeNull();
});

it('ошибка не создаёт файл и повторяется', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(csvResponse());
  render(<CsvButton path="/statistics/dkp/export.csv?table=members" label="ДКП" />);
  fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV: ДКП' }));
  await screen.findByText('Не удалось скачать CSV');
  expect(clickUrls).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV: ДКП' }));
  await waitFor(() => expect(clickUrls).toEqual(['blob:mock']));
});

it('отказ сервера (403) — ошибка, без пустого файла', async () => {
  fetchMock.mockResolvedValue(new Response('forbidden', { status: 403 }));
  render(<CsvButton path="/statistics/export.csv?table=gear-score" label="GS" />);
  fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV: GS' }));
  await screen.findByText('Не удалось скачать CSV');
  expect(clickUrls).toEqual([]);
});
