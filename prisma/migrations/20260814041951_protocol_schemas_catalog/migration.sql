-- CreateTable
CREATE TABLE "ProtocolDeployment" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "deployer" TEXT,
    "schemaRegistry" TEXT NOT NULL,
    "attesterRegistry" TEXT NOT NULL,
    "credentialStatusRegistry" TEXT NOT NULL,
    "complianceZkVerifier" TEXT,
    "didRegistry" TEXT,
    "nameRegistry" TEXT,
    "addressesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisteredSchema" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "schemaKey" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "schemaHash" TEXT,
    "uri" TEXT,
    "publisher" TEXT,
    "registerTx" TEXT,
    "onChain" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'tracked',
    "registeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegisteredSchema_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolDeployment_network_key" ON "ProtocolDeployment"("network");

-- CreateIndex
CREATE INDEX "RegisteredSchema_network_idx" ON "RegisteredSchema"("network");

-- CreateIndex
CREATE INDEX "RegisteredSchema_onChain_idx" ON "RegisteredSchema"("onChain");

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredSchema_network_schemaKey_key" ON "RegisteredSchema"("network", "schemaKey");
