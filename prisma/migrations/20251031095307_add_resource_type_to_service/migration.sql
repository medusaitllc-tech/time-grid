/*
  Warnings:

  - You are about to drop the column `services` on the `Employee` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "services";

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "resourceTypeId" BIGINT;

-- CreateIndex
CREATE INDEX "Service_resourceTypeId_idx" ON "Service"("resourceTypeId");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_resourceTypeId_fkey" FOREIGN KEY ("resourceTypeId") REFERENCES "ResourceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
