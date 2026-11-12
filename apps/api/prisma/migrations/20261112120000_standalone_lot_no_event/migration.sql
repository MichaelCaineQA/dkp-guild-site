-- Лот вне ивента «хранилище гильдии» (#137, план 2.4): дроп без ивента.
ALTER TABLE "LootDrop" ALTER COLUMN "eventId" DROP NOT NULL;
