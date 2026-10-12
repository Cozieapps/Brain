// Run only on a user-owned local machine/VM. Never copy credentials into chat.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { PlanLocal } from "../src/providers/plan-local";
import { verifyIdentity } from "../src/providers/oauth";
const [command, file, id] = process.argv.slice(2);
const vault = new PlanLocal(
  resolve(process.env.BESIDE_DATA_DIR ?? ".data") + "/provider",
);
await vault.init();
if (command === "list") {
  const v = await vault.status();
  console.log(
    JSON.stringify({ accounts: v.accounts, activeId: v.activeId }, null, 2),
  );
} else if (command === "export" && file && id) {
  await vault.locked(async (v) => {
    const r = v.registrations.find((r) => r.id === id);
    if (!r?.refreshToken) throw Error("Select a signed-in registration.");
    await writeFile(resolve(file), JSON.stringify(r), {
      mode: 0o600,
      flag: "wx",
    });
    delete r.accessToken;
    delete r.refreshToken;
    delete r.idToken;
    r.scopes = [];
    r.expiresAt = 0;
    const tmp = vault.path + ".transfer.tmp";
    await writeFile(tmp, JSON.stringify(v), { mode: 0o600, flag: "wx" });
    const { rename } = await import("node:fs/promises");
    await rename(tmp, vault.path);
  });
  console.log(
    "Protected transfer file created. This installation stopped using its tokens. Transfer it over SSH; remove the transfer file after successful import.",
  );
} else if (command === "import" && file) {
  const schema = z.object({
    id: z.string(),
    profileId: z.string(),
    clientId: z.string().regex(/^oaiapp_/),
    subject: z.string(),
    email: z.string(),
    label: z.string(),
    hostId: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
    idToken: z.string(),
    scopes: z.array(z.string()),
    expiresAt: z.number(),
  });
  const r = schema.parse(JSON.parse(await readFile(resolve(file), "utf8")));
  const identity = await verifyIdentity(r.idToken, r.clientId);
  if (identity.sub !== r.subject)
    throw Error(
      "Transferred identity does not match. Sign in locally again before transferring.",
    );
  await vault.locked(async (v) => {
    r.hostId = v.hostId;
    const existing = v.registrations.find(
      (x) => x.clientId === r.clientId && x.subject === r.subject,
    );
    if (!existing)
      r.profileId = v.registrations.length
        ? "account:" + crypto.randomUUID()
        : "personal";
    if (existing) {
      r.id = existing.id;
      r.profileId = existing.profileId;
      v.registrations = v.registrations.filter((x) => x.id !== existing.id);
    }
    v.registrations.push(r);
    v.activeId = r.id;
    v.model = undefined;
    const tmp = vault.path + ".import.tmp";
    await writeFile(tmp, JSON.stringify(v), { mode: 0o600, flag: "wx" });
    const { rename } = await import("node:fs/promises");
    await rename(tmp, vault.path);
  });
  console.log(
    "Imported. The VM host ID was preserved. This VM now owns token refresh. Remove the protected transfer file.",
  );
} else
  throw Error(
    "Usage: npm run plan:transfer -- list | export <protected-file> <registration-id> | import <protected-file>",
  );
