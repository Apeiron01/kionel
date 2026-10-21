# Kionel

**Verifiable file transfer from isolated computers — by screen and camera, printed pages, a one-way serial cable or the USB stick you already use.**

Kionel moves a file from a PC that must not be networked (a laboratory instrument PC, an OT workstation, an offline root CA) to another device, encrypted end to end, and produces two signed records: the sender signs what left, the receiver signs what arrived. Anyone can check those records offline, years later, with an Apache-2.0 verifier.

It runs in the browser. After the first visit it needs no network, and an isolated PC can use a single offline HTML file checked by its SHA-256.

- Live app: <https://kionel.com/transfer.html>
- Verify a record in your browser (nothing is uploaded): <https://kionel.com/verify.html>
- Method preprint: Bayar T. *Verifiable one-way file transfer across air gaps with screens, paper and serial cables.* Zenodo 2026. <https://doi.org/10.5281/zenodo.23064776>

## What it does

- **Screen → camera transfer** with an LT fountain code, so frames can be missed or read in any order; a time-division duplex ACK channel when both sides have cameras, and simplex fallback when they do not.
- **No camera on the PC?** The receiver shows a one-time 12-character code, or the devices pair by sound; a receiver card replaces the code for a fixed PC.
- **Film now, read later:** record the sending screen with any camera app and decode the video afterwards.
- **Printed pages:** print a file as pages of encrypted QR codes and read them back with a phone, in any order, from the paper or from photos and scans.
- **One-way serial cable** (RS-232 / USB serial with the return wire removed) as a low-cost data diode, including an unattended folder link.
- **USB route:** seal a file on the sender, carry it any way you like, and the receiver checks and signs for it.
- **Signed records:** X25519 handshake with a short authentication string compared on both screens, AES-256-GCM, Ed25519/P-256 dispatch and delivery records bound to a work order, a local hash-chained audit log, optional RFC 3161 timestamps, printable reports.

Its limits are documented, not hidden: [THREAT-MODEL.md](THREAT-MODEL.md), [SECURITY.md](SECURITY.md) and the [limits page](https://kionel.com/limits.html). **Kionel has not yet had an independent security audit**, and it does not inspect or sanitise file content.

## Quick start

Requires Node.js 22+ and pnpm 10.

```bash
pnpm install
pnpm test        # camera-free tests: core, QR, crypto, secure web flows
pnpm typecheck
pnpm dev         # https://<this-machine's-ip>:5173 — accept the local certificate on your phone
pnpm build       # static site in apps/web/dist
pnpm verify receipt.json [file]                 # offline receipt verifier
pnpm audit:verify ledger.json [receipt.json …]  # signed audit chain
pnpm bench                                       # synthetic channel measurements
```

The site worker that serves kionel.com (static assets, the RFC 3161 timestamp relay and the contact form) lives in `apps/commerce` — the folder keeps its historical name and sells nothing.

## Repository map

| Path | Contents |
|---|---|
| `packages/core`, `packages/transport-*` | Frame format, fountain code, optical transports |
| `packages/crypto` | Record types, canonical encoding, **all verification** (Apache-2.0) |
| `packages/issue` | Session set-up and record production |
| `packages/sdk`, `packages/enterprise`, `packages/control-plane` | Integration API, enrolment and revocation |
| `packages/attestation-*` | Android, Apple and Windows device attestation |
| `apps/web` | The transfer app and website |
| `apps/verify`, `apps/audit` | Offline verifier CLIs (Apache-2.0) |
| `native/` | Windows TPM key host and Android components |
| `research/` | The method preprint and its data |

Technical documents: [SPEC.md](SPEC.md) · [THREAT-MODEL.md](THREAT-MODEL.md) · [KEY-MANAGEMENT.md](KEY-MANAGEMENT.md) · [SDK.md](SDK.md) · [ENTERPRISE-TRUST.md](ENTERPRISE-TRUST.md) · [CONTROL-PLANE.md](CONTROL-PLANE.md) · [WINDOWS-TPM.md](WINDOWS-TPM.md) · [ANDROID-STRONGBOX.md](ANDROID-STRONGBOX.md) · [TESTING.md](TESTING.md) · [DEVICE-MATRIX.md](DEVICE-MATRIX.md)

## Licence

- **AGPL-3.0** for Kionel itself ([LICENSE](LICENSE)). If you distribute a changed version, or run one as a network service for others, publish its source under the same licence.
- **Apache-2.0** for the record-verification path ([LICENSE-APACHE](LICENSE-APACHE)), so records stay checkable without us.
- **Commercial licence** for closed-source products and services that embed Kionel: see [COMMERCIAL.md](COMMERCIAL.md).

The full map is in [LICENSING-MAP.md](LICENSING-MAP.md). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

"Kionel" and its logo identify this project; please do not present a changed version as the original.

## Author

Kionel is built by **Taha Bayar** ([ORCID 0009-0009-6247-4985](https://orcid.org/0009-0009-6247-4985)) at Lumina Digitale, Ankara. Questions, integration work and commercial licences: <https://kionel.com/contact.html> or `legal@luminadigitale.com`.
