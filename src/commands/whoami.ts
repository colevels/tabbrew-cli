import { fetchUserInfo } from "../api";
import { resolveToken } from "../credentials";
import { c, indent } from "../ui";

export async function whoami(): Promise<void> {
  const resolved = await resolveToken();
  if (!resolved) {
    console.log("Not logged in. Run `tabbrew login` first.");
    process.exitCode = 1;
    return;
  }

  const user = await fetchUserInfo();

  console.log(
    `${c.green("✓ Token is valid")} ${c.dim(`(source: ${resolved.source})`)}`,
  );
  console.log("");

  // Surface a few common identity fields when present, whatever the schema.
  const id = user.id ?? user.sub ?? user.user_id;
  const email = user.email;
  const name = user.name ?? user.username ?? user.login;
  if (id !== undefined) console.log(`  id:    ${String(id)}`);
  if (email !== undefined) console.log(`  email: ${String(email)}`);
  if (name !== undefined) console.log(`  name:  ${String(name)}`);

  console.log("");
  console.log(c.dim("  full response:"));
  console.log(indent(JSON.stringify(user, null, 2), 2));
}
