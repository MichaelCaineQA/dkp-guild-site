CREATE TABLE "DiscordNotification" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "DiscordNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiscordNotification_status_availableAt_idx" ON "DiscordNotification"("status", "availableAt");

CREATE TABLE "DiscordDeliveryGate" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "resumeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "DiscordDeliveryGate" ("id") VALUES (1);
