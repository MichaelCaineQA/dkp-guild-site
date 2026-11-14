ALTER TABLE "KP" ADD COLUMN "leaderId" TEXT;

CREATE TABLE "MemberPackHistory" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "previousPackId" TEXT,
    "packId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemberPackHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PackMembershipHistory" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "previousKpId" TEXT NOT NULL,
    "kpId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackMembershipHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KP_leaderId_key" ON "KP"("leaderId");
CREATE UNIQUE INDEX "MemberPackHistory_memberId_changedAt_key" ON "MemberPackHistory"("memberId", "changedAt");
CREATE UNIQUE INDEX "PackMembershipHistory_packId_changedAt_key" ON "PackMembershipHistory"("packId", "changedAt");

ALTER TABLE "KP" ADD CONSTRAINT "KP_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MemberPackHistory" ADD CONSTRAINT "MemberPackHistory_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberPackHistory" ADD CONSTRAINT "MemberPackHistory_previousPackId_fkey" FOREIGN KEY ("previousPackId") REFERENCES "Pack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberPackHistory" ADD CONSTRAINT "MemberPackHistory_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackMembershipHistory" ADD CONSTRAINT "PackMembershipHistory_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackMembershipHistory" ADD CONSTRAINT "PackMembershipHistory_previousKpId_fkey" FOREIGN KEY ("previousKpId") REFERENCES "KP"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PackMembershipHistory" ADD CONSTRAINT "PackMembershipHistory_kpId_fkey" FOREIGN KEY ("kpId") REFERENCES "KP"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
