import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SETTING_DEFAULTS } from '@dkp/shared';
import { SettingsEditor, type GameTimeValue } from './settings-editor';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: vi.fn() }));
const game = {
  gameTimeAnchor: '2026-01-01T00:00:00.123Z',
  gameTimeDayMinutes: 90,
  gameTimeNightMinutes: 30,
};
function Form() {
  const [settings, setSettings] = useState({ ...SETTING_DEFAULTS });
  const [cycle, setCycle] = useState<GameTimeValue>(game);
  return (
    <SettingsEditor
      settings={settings}
      gameTime={cycle}
      onSettingsSaved={setSettings}
      onGameTimeSaved={setCycle}
    />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  vi.mocked(api).mockImplementation(async (path, init) =>
    path === '/settings'
      ? { ...SETTING_DEFAULTS, ...JSON.parse(init!.body as string) }
      : { ...game, ...JSON.parse(init!.body as string) },
  );
});
afterEach(cleanup);
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const change = (label: RegExp, value: string) =>
  fireEvent.change(field(label), { target: { value } });
it('без изменений нет Сохранить, есть отдельные группы и все настройки', () => {
  render(<Form />);
  expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  expect(screen.getAllByRole('spinbutton')).toHaveLength(Object.keys(SETTING_DEFAULTS).length + 2);
  expect(screen.getByRole('region', { name: 'ДКП' })).toBeDefined();
});
it('ошибка у поля берётся из общего реестра; возвращение значения убирает Сохранить', () => {
  render(<Form />);
  change(/^Окно выбора кода/, '0');
  expect(screen.getByRole('alert').textContent).toContain('не меньше 30');
  const region = within(screen.getByRole('region', { name: 'Чек-ин' }));
  expect(region.getByRole('button', { name: 'Сохранить' }).hasAttribute('disabled')).toBe(true);
  change(/^Окно выбора кода/, '180');
  expect(region.queryByRole('button', { name: 'Сохранить' })).toBeNull();
  expect(api).not.toHaveBeenCalled();
});
it('отмена сброса ничего не меняет; подтверждение меняет только выбранный раздел без API', () => {
  render(<Form />);
  change(/^Окно выбора кода/, '240');
  change(/^Минимальный шаг ставки/, '7');
  const region = within(screen.getByRole('region', { name: 'Чек-ин' }));
  fireEvent.click(region.getByText('Сбросить к дефолтам'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Отмена'));
  expect(field(/^Окно выбора кода/).value).toBe('240');
  fireEvent.click(region.getByText('Сбросить к дефолтам'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сбросить' }));
  expect(field(/^Окно выбора кода/).value).toBe('180');
  expect(field(/^Минимальный шаг ставки/).value).toBe('7');
  expect(api).not.toHaveBeenCalled();
});
it('сбой сохранения сохраняет ввод, повтор отправляет только изменённые ключи', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('offline'));
  render(<Form />);
  change(/^Окно выбора кода/, '240');
  const region = within(screen.getByRole('region', { name: 'Чек-ин' }));
  fireEvent.click(region.getByText('Сохранить'));
  await screen.findByRole('alert');
  expect(field(/^Окно выбора кода/).value).toBe('240');
  fireEvent.click(region.getByText('Сохранить'));
  await screen.findByText('Сохранено');
  expect(region.queryByText('Сохранить')).toBeNull();
  expect(api).toHaveBeenLastCalledWith('/settings', {
    method: 'PUT',
    body: JSON.stringify({ 'checkin.windowSec': 240 }),
  });
});
it('изменение длительности не сдвигает якорь UTC и сохраняет его миллисекунды', async () => {
  render(<Form />);
  change(/^Дневная фаза/, '120');
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Игровой цикл' })).getByText('Сохранить'),
  );
  await screen.findByText('Сохранено');
  const body = JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string);
  expect(body.gameTimeAnchor).toBe(game.gameTimeAnchor);
  expect(body.gameTimeDayMinutes).toBe(120);
});
it('сброс цикла меняет только длительности и сохраняет введённый якорь', () => {
  render(<Form />);
  change(/^Якорь цикла/, '2026-02-02T22:30');
  const anchor = field(/^Якорь цикла/).value;
  change(/^Дневная фаза/, '120');
  change(/^Ночная фаза/, '45');
  const region = within(screen.getByRole('region', { name: 'Игровой цикл' }));
  fireEvent.click(region.getByText('Сбросить к дефолтам'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Сбросить' }));
  expect(field(/^Дневная фаза/).value).toBe('90');
  expect(field(/^Ночная фаза/).value).toBe('30');
  expect(field(/^Якорь цикла/).value).toBe(anchor);
  expect(api).not.toHaveBeenCalled();
});

it('возврат якоря к исходному местному времени убирает Сохранить, не отбрасывая точность UTC', () => {
  render(<Form />);
  const initial = field(/^Якорь цикла/).value;
  change(/^Якорь цикла/, '2026-02-02T22:30');
  change(/^Якорь цикла/, initial);
  expect(
    within(screen.getByRole('region', { name: 'Игровой цикл' })).queryByText('Сохранить'),
  ).toBeNull();
});
