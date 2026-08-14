import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import type { ContractAddresses, PerantoNetwork } from "@peranto/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Bundled Paseo defaults (same as Aura). Override via deployments JSON path. */
const PASEO: ContractAddresses = {
  ProtocolTreasury: "0x45e8ade918FB36867325E298a5A76180dd1DFF99",
  DisCOFactory: "0x988550A4bAD29F3d11BcAf5cB7274Ae1d0282b99",
  PerantoNode: "0xCc340938b25AA8D2C08760735611Ae57e75F8786",
  EcosystemLabNode: "0x99125a8024220e6A757282C9B07524B411872E2E",
  DIDRegistry: "0xe7e10dD5fd25053A3c35EDa8A771753B3E57D907",
  SchemaRegistry: "0xe76472ff2212B5aC8E027120043D30D520BD86B1",
  AttesterRegistry: "0x963eA758320e5273885EEF53bE99c608d5C555AB",
  CredentialStatusRegistry: "0xb321Ae1E98476752867a6191F74AeD2353c0c534",
  NameRegistry: "0x76b82117623Cc3793e0FA3768aE16A123Eaf9134",
  ComplianceZkVerifier: "0x4BA2dfc1Cbb370C3712fe011d9333bfb0CE0419E",
};

const PASEO_DEPLOYER =
  "0x354151d1039Ba06862f8a5062b37BCb8b082cEDF" as Address;

export type DeploymentMeta = {
  addresses: ContractAddresses;
  deployer: Address | null;
  schemas: Record<string, string>;
  path: string | null;
};

function deploymentPath(network: PerantoNetwork): string {
  return (
    process.env.DEPLOYMENT_JSON ||
    join(
      __dirname,
      "..",
      "..",
      "dids-vc-ecotesting",
      "packages",
      "web",
      "public",
      "deployments",
      network === "paseo" ? "paseo.json" : `${network}.json`
    )
  );
}

export function loadDeploymentMeta(network: PerantoNetwork): DeploymentMeta {
  const path = deploymentPath(network);
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      addresses?: ContractAddresses;
      contracts?: ContractAddresses;
      deployer?: string;
      schemas?: Record<string, string>;
    };
    const addresses =
      raw.addresses?.CredentialStatusRegistry
        ? raw.addresses
        : raw.contracts?.CredentialStatusRegistry
          ? raw.contracts
          : null;
    if (addresses) {
      return {
        addresses,
        deployer: (raw.deployer as Address) ?? null,
        schemas: raw.schemas ?? {},
        path,
      };
    }
  }
  if (network === "paseo") {
    return {
      addresses: PASEO,
      deployer: PASEO_DEPLOYER,
      schemas: {},
      path: existsSync(path) ? path : null,
    };
  }
  throw new Error(`No deployment addresses for ${network}`);
}

export function loadAddresses(network: PerantoNetwork): ContractAddresses {
  return loadDeploymentMeta(network).addresses;
}
