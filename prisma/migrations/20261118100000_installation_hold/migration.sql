-- An installation can be put on hold half-way: a status, and the company may still be unknown.
ALTER TABLE "Installation" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "Installation" ALTER COLUMN "customerId" DROP NOT NULL;
CREATE INDEX "Installation_companyId_status_idx" ON "Installation"("companyId", "status");
