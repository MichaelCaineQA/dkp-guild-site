import { describe, expect, it } from 'vitest';
import {
  formatTargetRoles,
  itemInputSchema,
  itemStartPrice,
  normalizeTargetRoles,
} from './items';

describe('items: справочник предметов (issue #92)', () => {
  describe('normalizeTargetRoles', () => {
    it('«Все» вытесняет конкретные роли', () => {
      expect(normalizeTargetRoles(['ALL', 'DPS'])).toEqual(['ALL']);
    });

    it('порядок ролей фиксирован и без дублей', () => {
      expect(normalizeTargetRoles(['TANK', 'DPS', 'DPS'])).toEqual(['DPS', 'TANK']);
    });
  });

  describe('itemInputSchema', () => {
    it('принимает минимальный ввод: название и «Все»', () => {
      const parsed = itemInputSchema.parse({ name: 'Клинок рассвета', targetRoles: ['ALL'] });
      expect(parsed).toEqual({
        name: 'Клинок рассвета',
        rarity: null,
        slot: null,
        targetRoles: ['ALL'],
        defaultStartPrice: null,
      });
    });

    it('обрезает пробелы и пустые подписи', () => {
      const parsed = itemInputSchema.parse({
        name: '  Шлем  ',
        rarity: ' ',
        slot: 'Голова',
        targetRoles: ['DPS', 'TANK'],
        defaultStartPrice: 150,
      });
      expect(parsed.name).toBe('Шлем');
      expect(parsed.rarity).toBeNull();
      expect(parsed.slot).toBe('Голова');
      expect(parsed.targetRoles).toEqual(['DPS', 'TANK']);
    });

    it('отклоняет пустое название, пустой мультивыбор и отрицательную цену', () => {
      expect(() =>
        itemInputSchema.parse({ name: ' ', targetRoles: ['ALL'] }),
      ).toThrow();
      expect(() => itemInputSchema.parse({ name: 'Меч', targetRoles: [] })).toThrow();
      expect(() =>
        itemInputSchema.parse({ name: 'Меч', targetRoles: ['ALL'], defaultStartPrice: -1 }),
      ).toThrow();
      expect(() =>
        itemInputSchema.parse({ name: 'Меч', targetRoles: ['ALL'], defaultStartPrice: 1.5 }),
      ).toThrow();
    });

    it('нормализует «Все» вместе с ролями', () => {
      const parsed = itemInputSchema.parse({
        name: 'Щит',
        targetRoles: ['TANK', 'ALL'],
      });
      expect(parsed.targetRoles).toEqual(['ALL']);
    });
  });

  describe('itemStartPrice (план 6)', () => {
    it('берёт рекомендованную цену предмета, иначе 0', () => {
      expect(itemStartPrice({ defaultStartPrice: 120 })).toBe(120);
      expect(itemStartPrice({ defaultStartPrice: null })).toBe(0);
    });
  });

  describe('formatTargetRoles', () => {
    it('печатает подписи по-русски', () => {
      expect(formatTargetRoles(['ALL'])).toBe('Все');
      expect(formatTargetRoles(['TANK', 'DPS'])).toBe('ДД, Танк');
    });
  });
});
