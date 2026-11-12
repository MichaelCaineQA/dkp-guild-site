import {
  parseSettingValue,
  SETTING_DEFAULTS,
  type AuctionSettingValues,
} from '@dkp/shared';

/** Ключи настроек аукциона, влияющие на дефолты и снапшоты нового лота. */
export const AUCTION_SETTING_KEYS = [
  'auction.step',
  'auction.liveDurationSec',
  'auction.longDurationDays',
  'auction.antiSnipeLiveSec',
  'auction.antiSnipeExtendLiveSec',
  'auction.antiSnipeLongSec',
  'auction.antiSnipeExtendLongSec',
  'auction.noBidTimeoutSec',
  'auction.foreignClassMarkupPct',
  'auction.preferredItemDiscountPct',
] as const;

/** Минимальный читатель Setting — юнит-тесты без Prisma. */
export interface AuctionSettingsDb {
  setting: {
    findMany(args: {
      where: { key: { in: string[] } };
      select: { key: true; value: true };
    }): Promise<{ key: string; value: unknown }[]>;
  };
}

/**
 * Настройки аукциона с дефолтами реестра для отсутствующих ключей.
 * Общая для лотов по дропу (loot) и лотов вне ивента (auctions, #137).
 */
export async function readAuctionSettings(db: AuctionSettingsDb): Promise<AuctionSettingValues> {
  const rows = await db.setting.findMany({
    where: { key: { in: [...AUCTION_SETTING_KEYS] } },
    select: { key: true, value: true },
  });
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const read = (key: (typeof AUCTION_SETTING_KEYS)[number]) =>
    parseSettingValue(key, stored.get(key) ?? SETTING_DEFAULTS[key]);
  return {
    step: read('auction.step'),
    liveDurationSec: read('auction.liveDurationSec'),
    longDurationDays: read('auction.longDurationDays'),
    antiSnipeLiveSec: read('auction.antiSnipeLiveSec'),
    antiSnipeExtendLiveSec: read('auction.antiSnipeExtendLiveSec'),
    antiSnipeLongSec: read('auction.antiSnipeLongSec'),
    antiSnipeExtendLongSec: read('auction.antiSnipeExtendLongSec'),
    noBidTimeoutSec: read('auction.noBidTimeoutSec'),
    foreignClassMarkupPct: read('auction.foreignClassMarkupPct'),
    preferredItemDiscountPct: read('auction.preferredItemDiscountPct'),
  };
}
