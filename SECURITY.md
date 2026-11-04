# Security policy

## Supported versions

Vynlore is a Windows desktop application distributed as an NSIS installer. Security fixes land on the latest release.

| Version | Supported |
|---|---|
| 1.2.x | Yes |
| < 1.2 | No |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Advisories → Report a vulnerability**.
3. Include the version, Windows version, audio device/output mode, reproduction steps and the impact you believe is possible.

If private reporting is unavailable, contact the maintainer privately through GitHub ([@dhanushbs10](https://github.com/dhanushbs10)) and ask for a secure channel.

## What is in scope

Vynlore is a local-first app with no telemetry. Examples of issues that matter:

- Arbitrary file read, write or delete through a Tauri command
- Path traversal in themes, playlists, cover art or tag editing
- Command or argument injection through file paths or media metadata
- CSP bypass, remote code loading or script injection in the webview
- Privilege escalation through the installer, autostart or file associations
- Memory-safety bugs in the Rust audio/library code
- Crashes caused by a malicious audio file that are likely to be exploitable

## Out of scope

- Issues that require physical access to an unlocked machine
- Social engineering of the user
- Denial of service from an intentionally enormous local file, unless it is trivially triggered by normal use
- Vulnerabilities in third-party dependencies that are already fixed upstream and not reachable through Vynlore
- The fact that the current installer is unsigned (tracked as a release-engineering task, not a vulnerability)

## What to expect

- Acknowledgment within 7 days.
- An initial assessment and a remediation plan after triage.
- Coordinated disclosure: we will agree on a date before publishing details.
- Credit in the advisory and release notes if you want it.

These are best-effort targets for a small project, not a commercial SLA.

## Hardening notes for contributors

- Keep the CSP strict. Do not add remote script origins.
- New Tauri commands must validate paths and sizes; do not trust the webview blindly.
- Prefer allow-lists over block-lists for file extensions and directories.
- Do not add telemetry, analytics or background network calls.
- Treat ID3/FLAC/MP4 metadata as untrusted input.
