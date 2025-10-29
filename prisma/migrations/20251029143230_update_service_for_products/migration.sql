/*
  Warnings:

  - You are about to drop the column `description` on the `Service` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Service` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `Service` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[productId,variantId,shop]` on the table `Service` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `productId` to the `Service` table without a default value. This is not possible if the table is not empty.
  - Added the required column `productTitle` to the `Service` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Service" DROP COLUMN "description",
DROP COLUMN "name",
DROP COLUMN "price",
ADD COLUMN     "productId" VARCHAR(255) NOT NULL,
ADD COLUMN     "productTitle" VARCHAR(255) NOT NULL,
ADD COLUMN     "variantId" VARCHAR(255),
ADD COLUMN     "variantTitle" VARCHAR(255);

-- CreateIndex
CREATE INDEX "Service_productId_idx" ON "Service"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_productId_variantId_shop_key" ON "Service"("productId", "variantId", "shop");
