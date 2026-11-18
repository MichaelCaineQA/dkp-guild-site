-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "isArchboss" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "preferredArchbossItemChangedAt" TIMESTAMP(3),
ADD COLUMN     "preferredArchbossItemId" TEXT,
ADD COLUMN     "prevPreferredArchbossItemId" TEXT;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_preferredArchbossItemId_fkey" FOREIGN KEY ("preferredArchbossItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_prevPreferredArchbossItemId_fkey" FOREIGN KEY ("prevPreferredArchbossItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
