/*
  Warnings:

  - You are about to drop the column `slotType` on the `Settings` table. All the data in the column will be lost.
  - You are about to drop the column `timeSlotSize` on the `Settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "serviceIds" JSONB;

-- AlterTable
ALTER TABLE "Settings" DROP COLUMN "slotType",
DROP COLUMN "timeSlotSize",
ADD COLUMN     "useResources" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ResourceType" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "shop" VARCHAR(255) NOT NULL,
    "storeId" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "shop" VARCHAR(255) NOT NULL,
    "storeId" BIGINT NOT NULL,
    "resourceTypeId" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResourceType_shop_idx" ON "ResourceType"("shop");

-- CreateIndex
CREATE INDEX "ResourceType_storeId_idx" ON "ResourceType"("storeId");

-- CreateIndex
CREATE INDEX "ResourceType_isActive_idx" ON "ResourceType"("isActive");

-- CreateIndex
CREATE INDEX "Resource_shop_idx" ON "Resource"("shop");

-- CreateIndex
CREATE INDEX "Resource_storeId_idx" ON "Resource"("storeId");

-- CreateIndex
CREATE INDEX "Resource_resourceTypeId_idx" ON "Resource"("resourceTypeId");

-- CreateIndex
CREATE INDEX "Resource_isActive_idx" ON "Resource"("isActive");

-- AddForeignKey
ALTER TABLE "ResourceType" ADD CONSTRAINT "ResourceType_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_resourceTypeId_fkey" FOREIGN KEY ("resourceTypeId") REFERENCES "ResourceType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
