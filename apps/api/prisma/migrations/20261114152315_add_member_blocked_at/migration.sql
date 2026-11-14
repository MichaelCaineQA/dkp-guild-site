-- Блокировка учётки покинувшего гильдию (#149): null — активен.
ALTER TABLE "Member" ADD COLUMN "blockedAt" TIMESTAMP(3);

-- Досадный drift с #137: миграция standalone_lot_no_event писалась вручную
-- и сделала только DROP NOT NULL; FK остался без ON DELETE SET NULL, который
-- схема Prisma требует (дефолт для optional-связи). Доводим FK до схемы.
-- DropForeignKey
ALTER TABLE "LootDrop" DROP CONSTRAINT "LootDrop_eventId_fkey";

-- AddForeignKey
ALTER TABLE "LootDrop" ADD CONSTRAINT "LootDrop_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
