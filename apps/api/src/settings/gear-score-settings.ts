import { parseSettingValue, SETTING_DEFAULTS } from '@dkp/shared';

export async function gearScoreStaleDays(db: {
  setting: {
    findMany(args: {
      where: { key: { in: string[] } };
      select: { key: true; value: true };
    }): Promise<{ key: string; value: unknown }[]>;
  };
}): Promise<number> {
  const key = 'profile.gearScoreStaleDays';
  const rows = await db.setting.findMany({
    where: { key: { in: [key] } },
    select: { key: true, value: true },
  });
  return parseSettingValue(
    key,
    rows.find((row) => row.key === key)?.value ?? SETTING_DEFAULTS[key],
  );
}
