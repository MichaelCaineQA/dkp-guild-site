ALTER TABLE "AbsenceSeen" ADD COLUMN "actorKey" TEXT;
UPDATE "AbsenceSeen" SET "actorKey" = "seenById";
ALTER TABLE "AbsenceSeen" ALTER COLUMN "actorKey" SET NOT NULL;
ALTER TABLE "AbsenceSeen" ALTER COLUMN "seenById" DROP NOT NULL;
CREATE UNIQUE INDEX "AbsenceSeen_absenceId_actorKey_key" ON "AbsenceSeen"("absenceId", "actorKey");
