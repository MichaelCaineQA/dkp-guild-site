-- CreateEnum
CREATE TYPE "MemberLinkRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "discordId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MemberLinkRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "status" "MemberLinkRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberLinkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberLinkRequest_userId_nickname_key" ON "MemberLinkRequest"("userId", "nickname");

-- AddForeignKey
ALTER TABLE "MemberLinkRequest" ADD CONSTRAINT "MemberLinkRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
