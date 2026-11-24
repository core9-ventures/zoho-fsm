-- Office can put a completed installation back on hold; earlier fill positions are kept
ALTER TABLE "Installation" ADD COLUMN "holdBy" TEXT,
ADD COLUMN "holdAt" TIMESTAMPTZ(3),
ADD COLUMN "fillHistory" JSONB NOT NULL DEFAULT '[]';
