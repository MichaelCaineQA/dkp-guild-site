-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "discountPct" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN     "discountPct" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LootAward" ADD COLUMN     "discountPct" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "combatRoleChangedAt" TIMESTAMP(3),
ADD COLUMN     "preferredItemChangedAt" TIMESTAMP(3),
ADD COLUMN     "preferredItemId" TEXT,
ADD COLUMN     "prevCombatRole" "CombatRole",
ADD COLUMN     "prevPreferredItemId" TEXT;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_preferredItemId_fkey" FOREIGN KEY ("preferredItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_prevPreferredItemId_fkey" FOREIGN KEY ("prevPreferredItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
