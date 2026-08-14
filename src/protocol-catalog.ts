import { prisma } from "./db.js";
import {
  SCHEMA_KEYS,
  schemaIdFromKey,
  type ContractAddresses,
  type PerantoNetwork,
  type PerantoClient,
} from "@peranto/sdk";
import type { Address, Hex } from "viem";

const TRACKED_SCHEMAS = [
  SCHEMA_KEYS.LivenessCheck,
  SCHEMA_KEYS.ProofOfResidence,
];

export async function syncProtocolDeployment(params: {
  network: PerantoNetwork;
  deployer: string | null;
  addresses: ContractAddresses;
  schemasFromDeploy?: Record<string, string>;
}) {
  const { network, deployer, addresses, schemasFromDeploy } = params;
  await prisma.protocolDeployment.upsert({
    where: { network },
    create: {
      network,
      deployer,
      schemaRegistry: addresses.SchemaRegistry,
      attesterRegistry: addresses.AttesterRegistry,
      credentialStatusRegistry: addresses.CredentialStatusRegistry,
      complianceZkVerifier: addresses.ComplianceZkVerifier ?? null,
      didRegistry: addresses.DIDRegistry ?? null,
      nameRegistry: addresses.NameRegistry ?? null,
      addressesJson: addresses as object,
    },
    update: {
      deployer,
      schemaRegistry: addresses.SchemaRegistry,
      attesterRegistry: addresses.AttesterRegistry,
      credentialStatusRegistry: addresses.CredentialStatusRegistry,
      complianceZkVerifier: addresses.ComplianceZkVerifier ?? null,
      didRegistry: addresses.DIDRegistry ?? null,
      nameRegistry: addresses.NameRegistry ?? null,
      addressesJson: addresses as object,
    },
  });

  const keys = new Set([
    ...TRACKED_SCHEMAS,
    ...Object.keys(schemasFromDeploy ?? {}),
  ]);
  for (const schemaKey of keys) {
    const schemaId =
      schemasFromDeploy?.[schemaKey] ?? schemaIdFromKey(schemaKey);
    await prisma.registeredSchema.upsert({
      where: {
        network_schemaKey: { network, schemaKey },
      },
      create: {
        network,
        schemaKey,
        schemaId,
        source: schemasFromDeploy?.[schemaKey] ? "deploy" : "tracked",
        onChain: Boolean(schemasFromDeploy?.[schemaKey]),
      },
      update: {
        schemaId,
        onChain: Boolean(schemasFromDeploy?.[schemaKey]),
      },
    });
  }
}

export async function recordRegisteredSchema(params: {
  network: string;
  schemaKey: string;
  schemaId: Hex;
  schemaHash?: Hex;
  uri?: string;
  publisher?: Address;
  txHash?: Hex;
  source?: string;
}) {
  return prisma.registeredSchema.upsert({
    where: {
      network_schemaKey: {
        network: params.network,
        schemaKey: params.schemaKey,
      },
    },
    create: {
      network: params.network,
      schemaKey: params.schemaKey,
      schemaId: params.schemaId,
      schemaHash: params.schemaHash ?? null,
      uri: params.uri ?? null,
      publisher: params.publisher ?? null,
      registerTx: params.txHash ?? null,
      onChain: true,
      source: params.source ?? "ops",
      registeredAt: new Date(),
    },
    update: {
      schemaId: params.schemaId,
      schemaHash: params.schemaHash ?? undefined,
      uri: params.uri ?? undefined,
      publisher: params.publisher ?? undefined,
      registerTx: params.txHash ?? undefined,
      onChain: true,
      source: params.source ?? "ops",
      registeredAt: new Date(),
    },
  });
}

export async function listOpsSchemas(params: {
  network: string;
  client: PerantoClient;
  attester: Address;
}) {
  const deployment = await prisma.protocolDeployment.findUnique({
    where: { network: params.network },
  });
  const rows = await prisma.registeredSchema.findMany({
    where: { network: params.network },
    orderBy: { schemaKey: "asc" },
  });

  const enriched = [];
  for (const row of rows) {
    let onChain = row.onChain;
    let uri = row.uri;
    let publisher = row.publisher;
    let schemaHash = row.schemaHash;
    let authorized = false;
    try {
      const remote = await params.client.getSchema(row.schemaKey);
      onChain = remote.exists;
      if (remote.exists) {
        uri = remote.uri || uri;
        publisher = remote.publisher;
        schemaHash = remote.schemaHash;
        await prisma.registeredSchema.update({
          where: { id: row.id },
          data: {
            onChain: true,
            uri: remote.uri || undefined,
            publisher: remote.publisher,
            schemaHash: remote.schemaHash,
            schemaId: remote.schemaId,
          },
        });
      }
      authorized = await params.client.isAuthorized(
        params.attester,
        row.schemaKey
      );
    } catch {
      /* keep DB snapshot */
    }
    enriched.push({
      id: row.id,
      schemaKey: row.schemaKey,
      schemaId: row.schemaId,
      schemaHash,
      uri,
      publisher,
      registerTx: row.registerTx,
      onChain,
      authorized,
      source: row.source,
      registeredAt: row.registeredAt,
      updatedAt: row.updatedAt,
    });
  }

  return {
    deployment: deployment
      ? {
          network: deployment.network,
          deployer: deployment.deployer,
          schemaRegistry: deployment.schemaRegistry,
          attesterRegistry: deployment.attesterRegistry,
          credentialStatusRegistry: deployment.credentialStatusRegistry,
          complianceZkVerifier: deployment.complianceZkVerifier,
          didRegistry: deployment.didRegistry,
          nameRegistry: deployment.nameRegistry,
          updatedAt: deployment.updatedAt,
        }
      : null,
    schemas: enriched,
  };
}
