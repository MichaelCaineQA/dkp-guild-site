ALTER TABLE "Auction" ADD COLUMN "bidderProfiles" JSONB;

-- До внедрения снимков доступно лишь одно предыдущее значение. Сохраняем
-- максимально точное восстановление старого алгоритма; новые лоты полностью независимы от профиля.
UPDATE "Auction" a SET "bidderProfiles" = COALESCE((
  SELECT jsonb_object_agg(m.id, jsonb_build_object(
    'combatRole', CASE WHEN m."combatRoleChangedAt" > a."createdAt" THEN m."prevCombatRole" ELSE m."combatRole" END,
    'preferredItemId', CASE WHEN m."preferredItemChangedAt" > a."createdAt" THEN m."prevPreferredItemId" ELSE m."preferredItemId" END
  )) FROM "Member" m WHERE m."createdAt" <= a."createdAt"
), '{}');
