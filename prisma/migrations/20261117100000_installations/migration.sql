-- New installations: a device installed on a new vehicle (photos and videos are Attachments of type INSTALLATION).
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleNo" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "simNo" TEXT,
    "installDate" DATE NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "deviceType" TEXT NOT NULL,
    "hasTempSensor" BOOLEAN NOT NULL DEFAULT false,
    "checklist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Installation_companyId_installDate_idx" ON "Installation"("companyId", "installDate");
CREATE INDEX "Installation_companyId_vehicleNo_idx" ON "Installation"("companyId", "vehicleNo");
CREATE INDEX "Installation_companyId_customerId_idx" ON "Installation"("companyId", "customerId");
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Installation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Installation"
    USING (app_bypass() OR "companyId" = app_company_id())
    WITH CHECK (app_bypass() OR "companyId" = app_company_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Installation" TO fieldserve_app;
