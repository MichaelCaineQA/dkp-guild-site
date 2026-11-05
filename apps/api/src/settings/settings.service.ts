import { Injectable, NotFoundException } from '@nestjs/common';
import {
  SETTINGS_REGISTRY,
  SETTING_DEFAULTS,
  gameTimeSettingsSchema,
  parseSettingValue,
  updateSettingsSchema,
  type GameTimeSettings,
  type SettingKey,
  type UpdateSettingsInput,
} from '@dkp/shared';
import type { AuditWriter } from '../members/members.service';

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface SettingsDb {
  setting: {
    findMany(): Promise<Array<{ key: string; value: number }>>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: number };
      update: { value: number };
    }): Promise<unknown>;
  };
  guild: {
    findFirst(): Promise<GameTimeSettings | null>;
    update(args: {
      where: { id: string };
      data: Partial<GameTimeSettings>;
    }): Promise<GameTimeSettings>;
  };
  auditLog: AuditWriter;
}

/** Действующий пользователь сессии — как в members.service. */
export interface SettingsActor {
  memberId: string | null;
  isAdmin: boolean;
}

/**
 * Настройки системы (issue #7): чтение — всем членам, запись — Глава/Админ
 * (право settings.manage вешает контроллер). Каждое изменение — в AuditLog.
 * Значения валидируются реестром @dkp/shared; отсутствующие ключи отдаются
 * с дефолтами, чтобы UI не зависел от полноты seed'а.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly db: SettingsDb) {}

  /** Все настройки с дефолтами для отсутствующих. */
  async getAll(): Promise<Record<SettingKey, number>> {
    const rows = await this.db.setting.findMany();
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const result = { ...SETTING_DEFAULTS };
    for (const key of Object.keys(result) as SettingKey[]) {
      const value = stored.get(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Запись набора настроек: валидация реестром, upsert каждого ключа,
   * одна запись аудита с перечнем изменений. Изменение применяется сразу —
   * читается на запросе, без деплоя.
   */
  async update(body: unknown, actor: SettingsActor): Promise<Record<SettingKey, number>> {
    const input: UpdateSettingsInput = updateSettingsSchema.parse(body);

    const current = await this.getAll();
    const changes: string[] = [];
    for (const [key, rawValue] of Object.entries(input)) {
      const value = parseSettingValue(key, rawValue);
      if (current[key as SettingKey] === value) {
        continue; // не трогаем и не шумим в аудите неизменённое
      }
      changes.push(`${key}: ${current[key as SettingKey]} → ${value}`);
      await this.db.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }

    if (changes.length > 0) {
      await this.db.auditLog.create({
        data: {
          actorMemberId: actor.memberId,
          action: 'SETTINGS_UPDATE',
          entityType: 'Setting',
          entityId: 'batch',
          comment: changes.join('; '),
        },
      });
    }
    return this.getAll();
  }

  /** Игровой цикл (план 2.1): хранится на Guild, редактируется через настройки. */
  async getGameTime(): Promise<GameTimeSettings> {
    const guild = await this.db.guild.findFirst();
    if (!guild) {
      throw new NotFoundException('Гильдия не найдена');
    }
    return guild;
  }

  async updateGameTime(body: unknown, actor: SettingsActor): Promise<GameTimeSettings> {
    const input = gameTimeSettingsSchema.parse(body);
    const guild = await this.getGameTime();

    const updated = await this.db.guild.update({
      where: { id: (guild as GameTimeSettings & { id: string }).id },
      data: {
        gameTimeAnchor: input.gameTimeAnchor,
        gameTimeDayMinutes: input.gameTimeDayMinutes,
        gameTimeNightMinutes: input.gameTimeNightMinutes,
      },
    });
    await this.db.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        action: 'SETTINGS_UPDATE',
        entityType: 'Guild',
        entityId: (guild as GameTimeSettings & { id: string }).id,
        comment: `Игровой цикл: якорь ${input.gameTimeAnchor.toISOString()}, день ${input.gameTimeDayMinutes} мин, ночь ${input.gameTimeNightMinutes} мин`,
      },
    });
    return updated;
  }
}

/** Метаданные реестра для UI (подписи и единицы). */
export function settingsMetadata(): Array<{
  key: SettingKey;
  label: string;
  unit?: string;
  plan: string;
}> {
  return (Object.keys(SETTINGS_REGISTRY) as SettingKey[]).map((key) => ({
    key,
    label: SETTINGS_REGISTRY[key].label,
    unit: SETTINGS_REGISTRY[key].unit,
    plan: SETTINGS_REGISTRY[key].plan,
  }));
}
