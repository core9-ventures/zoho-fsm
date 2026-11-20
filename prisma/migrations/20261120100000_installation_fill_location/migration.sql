-- Where the technician's phone was when the installation form was saved
ALTER TABLE "Installation" ADD COLUMN "fillLatitude" DECIMAL(9,6),
ADD COLUMN "fillLongitude" DECIMAL(9,6),
ADD COLUMN "fillAccuracy" INTEGER,
ADD COLUMN "fillAt" TIMESTAMPTZ(3);
