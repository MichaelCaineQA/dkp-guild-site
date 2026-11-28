ALTER TABLE "Member" ADD COLUMN "directKpId" TEXT;
ALTER TABLE "MemberPackHistory" ADD COLUMN "previousDirectKpId" TEXT,
    ADD COLUMN "directKpId" TEXT;

CREATE INDEX "Member_directKpId_idx" ON "Member"("directKpId");

ALTER TABLE "Member" ADD CONSTRAINT "Member_directKpId_fkey"
    FOREIGN KEY ("directKpId") REFERENCES "KP"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "Member_membership_check" CHECK ("directKpId" IS NULL OR "packId" IS NULL);

ALTER TABLE "MemberPackHistory" ADD CONSTRAINT "MemberPackHistory_previousDirectKpId_fkey"
    FOREIGN KEY ("previousDirectKpId") REFERENCES "KP"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "MemberPackHistory_directKpId_fkey"
    FOREIGN KEY ("directKpId") REFERENCES "KP"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
