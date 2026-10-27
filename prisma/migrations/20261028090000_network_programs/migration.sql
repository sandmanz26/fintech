-- AlterTable
ALTER TABLE "DailyMerchantMetric" ADD COLUMN     "mcChargebackCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mcSettledCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visaCnpSettledCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visaDisputeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visaFraudOverlapCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visaFraudReportCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Owner" ADD COLUMN     "lastScreenedAt" TIMESTAMP(3),
ADD COLUMN     "screenedListVersion" TEXT;

-- AlterTable
ALTER TABLE "TerminatedListEntry" ADD COLUMN     "idNumber" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "cardBrand" TEXT NOT NULL DEFAULT 'VISA',
ADD COLUMN     "isCardPresent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FraudReport" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "cardBrand" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteScan" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT NOT NULL,
    "live" BOOLEAN NOT NULL,
    "refundPolicy" BOOLEAN NOT NULL,
    "terms" BOOLEAN NOT NULL,
    "contact" BOOLEAN NOT NULL,
    "categories" TEXT[],
    "findings" TEXT[],

    CONSTRAINT "WebsiteScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FraudReport_merchantId_reportedAt_idx" ON "FraudReport"("merchantId", "reportedAt");

-- CreateIndex
CREATE INDEX "FraudReport_reportedAt_idx" ON "FraudReport"("reportedAt");

-- CreateIndex
CREATE INDEX "WebsiteScan_merchantId_scannedAt_idx" ON "WebsiteScan"("merchantId", "scannedAt");

-- AddForeignKey
ALTER TABLE "FraudReport" ADD CONSTRAINT "FraudReport_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteScan" ADD CONSTRAINT "WebsiteScan_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

