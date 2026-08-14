-- AlterTable
ALTER TABLE "Application" ADD COLUMN "externalRef" TEXT;

-- CreateIndex
CREATE INDEX "Application_externalRef_idx" ON "Application"("externalRef");
