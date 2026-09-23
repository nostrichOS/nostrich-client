-- CreateTable
CREATE TABLE "trending_snapshots" (
    "hours" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "kept" INTEGER NOT NULL,
    "offered" INTEGER NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trending_snapshots_pkey" PRIMARY KEY ("hours")
);

