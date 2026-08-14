-- CreateEnum
CREATE TYPE "ApplicationMode" AS ENUM ('CLAIMS', 'ZK');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'REVIEWED');

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "bountyId" TEXT NOT NULL DEFAULT 'kusama-privacy-identity',
    "subjectDid" TEXT NOT NULL,
    "subjectAddress" TEXT NOT NULL,
    "mode" "ApplicationMode" NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "challenge" TEXT,
    "liveCredHash" TEXT,
    "resCredHash" TEXT,
    "schemaKey" TEXT,
    "liveValid" BOOLEAN,
    "residenceValid" BOOLEAN,
    "jwtValid" BOOLEAN,
    "onChainValid" BOOLEAN,
    "commitmentMatch" BOOLEAN,
    "policyRootMatch" BOOLEAN,
    "disclosedScore" TEXT,
    "disclosedCountry" TEXT,
    "disclosedExpires" TEXT,
    "profileJson" JSONB NOT NULL,
    "checksJson" JSONB,
    "applicantNote" TEXT,
    "curatorNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Application_bountyId_createdAt_idx" ON "Application"("bountyId", "createdAt");

-- CreateIndex
CREATE INDEX "Application_subjectDid_idx" ON "Application"("subjectDid");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Application_subjectAddress_idx" ON "Application"("subjectAddress");
