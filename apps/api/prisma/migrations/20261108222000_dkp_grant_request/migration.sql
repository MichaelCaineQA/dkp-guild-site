ALTER TABLE "DkpEntry" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "DkpEntry_requestId_key" ON "DkpEntry"("requestId");
