CREATE TABLE "EventSummaryBatch" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "actorKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "actionCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventSummaryBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventSummaryBatch_eventId_idx" ON "EventSummaryBatch"("eventId");
ALTER TABLE "EventSummaryBatch" ADD CONSTRAINT "EventSummaryBatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
