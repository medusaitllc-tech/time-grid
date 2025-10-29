-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "shop" VARCHAR(255) NOT NULL,
    "storeId" TEXT NOT NULL,
    "workingHoursStart" VARCHAR(5) NOT NULL DEFAULT '09:00',
    "workingHoursEnd" VARCHAR(5) NOT NULL DEFAULT '17:00',
    "timeSlotSize" INTEGER NOT NULL DEFAULT 30,
    "openDays" VARCHAR(50) NOT NULL DEFAULT '1,2,3,4,5',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Settings_storeId_key" ON "Settings"("storeId");

-- CreateIndex
CREATE INDEX "Settings_shop_idx" ON "Settings"("shop");

-- CreateIndex
CREATE INDEX "Settings_storeId_idx" ON "Settings"("storeId");

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
