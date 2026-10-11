# Security policy

## Reporting a vulnerability

Please **don't** report security problems in a public issue.

Report them privately through GitHub instead: go to the repository's **Security** tab and choose **Report a vulnerability**. Include:

- what the problem is and what an attacker could do with it
- the steps to reproduce it, or a proof of concept
- the version or commit you tested

We'll confirm we've received your report within 3 working days. We'll keep you updated while we fix it, and credit you in the release notes unless you'd rather we didn't.

## Scope

Frametell runs on your own computer. These issues matter most to us:

- API keys or proxy passwords leaking out of `~/.frametell`, the settings panel or the logs
- another website or another user on the same machine reaching the local studio server, which is protected by a token
- material or a model's output making Frametell run commands or read files outside the project

## Supported versions

Frametell is in active development. Security fixes go into the latest release and `main` only.
