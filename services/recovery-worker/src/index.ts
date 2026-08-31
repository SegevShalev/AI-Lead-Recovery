import { loadEnv } from "@ai-lead-recovery/config";
import { describeStartup } from "./worker.js";

const env = loadEnv();
console.log(describeStartup(env));

// No queue consumer yet — this is Phase 0 scaffolding only.
// Phase 1 wires this process to the local queue adapter / SQS and the recovery rules.
