ALTER TYPE "DkpEntryType" ADD VALUE 'WEEKLY_DECAY';

-- Строку настройки блокируют сохранение процента и расчёт на границе недели.
INSERT INTO "Setting" ("key", "value") VALUES ('dkp.weeklyDecayPct', '0'::jsonb)
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE "DkpDecayRate" (
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "percent" INTEGER NOT NULL CHECK ("percent" BETWEEN 0 AND 100),
    CONSTRAINT "DkpDecayRate_pkey" PRIMARY KEY ("effectiveAt")
);

CREATE TABLE "DkpDecayRun" (
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DkpDecayRun_pkey" PRIMARY KEY ("scheduledAt")
);
