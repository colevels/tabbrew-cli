# Security

TabBrew CLI holds your TabBrew OAuth token and drives your Chrome browser, so a
vulnerability in it can reach your account and your open tabs. Please report
issues privately rather than in a public issue.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:

https://github.com/colevels/tabbrew-cli/security/advisories/new

Include the CLI version (`tabbrew --version`), your platform, and steps to
reproduce. You will get an acknowledgement within a few days, and a fix or a
public advisory once the issue is understood.

## How the session decides who is calling

The session listens on `127.0.0.1` only and tells its callers apart by what a
browser cannot leave out:

- **A local process** sends neither `Origin` nor `Sec-Fetch-*`. Only such a
  caller may call an operator or a plugin command, read the plugin registry or
  stop the session. A web page cannot strip those headers, so it cannot drive
  Chrome through the session.
- **An extension page** declares what it serves with a `POST`, and is known by
  the `Origin: chrome-extension://<id>` on it, which no web page can send. It
  polls with the token that answer gave it. Any Chrome extension may declare
  plugin commands; there is no allowlist. The first one to declare a namespace
  holds it for the life of the session.

What a plugin declares is written by its extension, not by TabBrew, and it
ends up in `tabbrew plugin --help`, which AI agents read. It is cut to length,
stripped of control and bidirectional characters, and an example is kept only
if it calls that plugin and carries no shell syntax. It never appears in
`tabbrew --help`. The page a plugin asks the CLI to open is accepted only as a
plain path inside that extension.

Known gap: a page that never declared (the TabBrew extension on the Web Store
today, and every `@tabbrew/sdk` before plugins) polls without a token, and the
session cannot tell it from a web page making the same request. Such a page
could claim an operator call and answer it falsely. It cannot call anything.
This closes once every supported extension declares and the token-less pool is
retired.

## Supported versions

Only the latest release receives security fixes. Update with your package
manager or the install script in the README.
