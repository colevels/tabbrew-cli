import { clearCredentials, CRED_PATH } from "../credentials";
import { config } from "../config";
import { c } from "../ui";

export async function logout(): Promise<void> {
  const removed = await clearCredentials();

  if (removed) {
    console.log(`${c.green("✓ Logged out.")} Removed ${c.dim(CRED_PATH)}.`);
  } else {
    console.log("Nothing to do — no stored credentials found.");
  }

  if (process.env[config.tokenEnvVar]) {
    console.log(
      c.yellow(
        `Note: $${config.tokenEnvVar} is still set in your environment and will keep authenticating requests.`,
      ),
    );
  }
}
