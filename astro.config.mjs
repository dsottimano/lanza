// Tenant-role Astro config. In a real tenant repo this imports from the published
// package: `import { lanzaConfig } from "@lanza/site/astro"`. In this monorepo
// (which IS @lanza/site) it imports the factory directly — see astro-config.mjs.
import { lanzaConfig } from "./astro-config.mjs";

export default lanzaConfig();
