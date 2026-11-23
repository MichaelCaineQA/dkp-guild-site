ALTER TABLE "DiscordNotification" ADD COLUMN "predecessorId" TEXT;
CREATE TABLE "DiscordLotCursor" (
  "auctionId" TEXT NOT NULL PRIMARY KEY,
  "lastNotificationId" TEXT
);
