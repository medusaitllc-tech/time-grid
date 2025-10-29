-- CreateTable
CREATE TABLE "GlamifyLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "generationDuration" INTEGER NOT NULL,
    "generatedImageSize" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlamifyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlamifyLog_shop_idx" ON "GlamifyLog"("shop");

-- CreateIndex
CREATE INDEX "GlamifyLog_createdAt_idx" ON "GlamifyLog"("createdAt");
