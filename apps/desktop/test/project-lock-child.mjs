// Child process for project-lock-processes.test.ts: a stand-in for a second OpenReel instance.
// usage: node project-lock-child.mjs <project path> <owner id> <path of the stripped project-lock module>
// Prints the acquire result as JSON, then (when acquired) holds the lock until it reads "release" on stdin.
import { pathToFileURL } from "node:url";
const [projectPath, owner, lockModule] = process.argv.slice(2);
// Dynamic import needs a file:// URL: a bare "C:\\..." path is rejected on Windows.
// The test strips the types off src/main/project-lock.ts into an .mjs and passes its path.
const { ProjectLocks } = await import(pathToFileURL(lockModule).href);
const locks = new ProjectLocks({ instanceId: owner.split(":")[0] });
const result = await locks.acquire(projectPath, owner);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "acquired") process.exit(0);
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  if (!String(chunk).includes("release")) return;
  await locks.releaseOwner(owner);
  process.stdout.write("released\n");
  process.exit(0);
});
