import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standaloneRoot = path.join(root, ".next", "standalone");
const staticSource = path.join(root, ".next", "static");
const staticTarget = path.join(standaloneRoot, ".next", "static");
const publicSource = path.join(root, "public");
const publicTarget = path.join(standaloneRoot, "public");

await mkdir(path.dirname(staticTarget), { recursive: true });
await mkdir(publicTarget, { recursive: true });
await cp(staticSource, staticTarget, { recursive: true });
await cp(publicSource, publicTarget, { recursive: true });