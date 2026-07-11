import { pollForToken, requestDeviceCode } from "../auth";
import { saveCredentials } from "../credentials";
import { c } from "../ui";
import { openBrowser } from "../util";

export async function login(): Promise<void> {
  console.log("Requesting a device code…");
  const device = await requestDeviceCode();

  const openUrl = device.verification_uri_complete ?? device.verification_uri;

  console.log("");
  console.log("  To sign in, open:");
  console.log(`    ${c.cyan(device.verification_uri)}`);
  console.log("  and enter the code:");
  console.log(`    ${c.bold(device.user_code)}`);
  console.log("");

  const opened = await openBrowser(openUrl);
  console.log(
    opened
      ? c.dim("  (opened your browser automatically)")
      : c.dim("  (open the URL above in your browser manually)"),
  );
  console.log("");

  const token = await pollForToken(device, (msg) => {
    // Overwrite the same line so polling stays tidy.
    process.stdout.write(`  ${c.dim(msg)}\x1b[K\r`);
  });
  process.stdout.write("\n");

  const now = Date.now();
  const path = await saveCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    token_type: token.token_type,
    scope: token.scope,
    expires_at: token.expires_in ? now + token.expires_in * 1000 : undefined,
    obtained_at: now,
  });

  console.log(
    `${c.green("✓ Logged in.")} Token saved to ${c.dim(path)} ${c.dim("(chmod 600)")}.`,
  );
}
