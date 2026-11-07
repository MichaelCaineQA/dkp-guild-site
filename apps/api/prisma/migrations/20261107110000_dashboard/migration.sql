ALTER TABLE "Event" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
UPDATE "Event" SET "name" = "EventType"."name" FROM "EventType" WHERE "Event"."eventTypeId" = "EventType"."id";
ALTER TABLE "Member" ADD COLUMN "packJoinedAt" TIMESTAMP(3);
