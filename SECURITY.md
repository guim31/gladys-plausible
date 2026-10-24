# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **Stats API key** of a Plausible account, stored by Gladys in the
  integration configuration (never written to `/data`, never logged); it is
  only sent to the address configured (or to `https://plausible.io`), and
  redirects are not followed so it never reaches another host. A Stats API key
  is read-only;
- `/data/plausible-state.json`: what the scene triggers remember per site
  (spike under way, day of the first visitor, silent or not; no secret);
- network: HTTP(S) requests to Plausible, nothing else; no port is opened.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Plausible itself (plausible.io or the self-hosted server).
