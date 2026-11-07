-- Старые заявки сохраняют календарный период; новые могут относиться к одному ивенту.
ALTER TABLE "Absence" ADD COLUMN "eventId" TEXT;
CREATE INDEX "Absence_eventId_idx" ON "Absence"("eventId");
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AbsenceSeen" DROP CONSTRAINT "AbsenceSeen_absenceId_fkey";
ALTER TABLE "AbsenceSeen" ADD CONSTRAINT "AbsenceSeen_absenceId_fkey" FOREIGN KEY ("absenceId") REFERENCES "Absence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
