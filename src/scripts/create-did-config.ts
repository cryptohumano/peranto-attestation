import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDidConfigurationForOrigin,
  type PerantoNetwork,
} from "@peranto/sdk";
import type { Hex } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const key = process.env.ATTESTER_PRIVATE_KEY as Hex;
const network = (process.env.PERANTO_NETWORK ?? "paseo") as PerantoNetwork;
const origin = (process.env.PUBLIC_ORIGIN ?? "http://localhost:8787").replace(
  /\/$/,
  ""
);

if (!key) {
  console.error("ATTESTER_PRIVATE_KEY required");
  process.exit(1);
}

const { didConfiguration, issued } = await createDidConfigurationForOrigin({
  issuerPrivateKey: key,
  network,
  origin,
});

const dir = join(__dirname, "..", "..", "data");
mkdirSync(dir, { recursive: true });
const out = join(dir, "did-configuration.json");
writeFileSync(out, JSON.stringify(didConfiguration, null, 2));
console.log(`Wrote ${out}`);
console.log(`issuerDid ${issued.issuerDid}`);
console.log(`origin ${issued.origin}`);
