/*
  Warnings:

  - You are about to drop the column `generatedImageSize` on the `GlamifyLog` table. All the data in the column will be lost.
  - You are about to alter the column `shop` on the `GlamifyLog` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(255)`.
  - You are about to alter the column `productId` on the `GlamifyLog` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(255)`.
  - You are about to alter the column `productName` on the `GlamifyLog` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(500)`.
  - Changed the type of `action` on the `GlamifyLog` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "GlamifyAction" AS ENUM ('add', 'replace');

-- AlterTable
ALTER TABLE "GlamifyLog" DROP COLUMN "generatedImageSize",
ADD COLUMN     "imageHeight" INTEGER,
ADD COLUMN     "imageWidth" INTEGER,
ALTER COLUMN "shop" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "productId" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "productName" SET DATA TYPE VARCHAR(500),
DROP COLUMN "action",
ADD COLUMN     "action" "GlamifyAction" NOT NULL;

-- CreateIndex
CREATE INDEX "GlamifyLog_action_idx" ON "GlamifyLog"("action");
