-- Серии повторяющихся ивентов (план 2.1, issue #8): создаются
-- и удаляются целиком, пока все ивенты серии запланированы.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "seriesId" TEXT;

-- CreateIndex
CREATE INDEX "Event_seriesId_idx" ON "Event"("seriesId");
