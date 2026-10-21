# Which file is under which licence

Kionel is open source. This repository uses **two licences**, split by package:

> **Kionel is AGPL-3.0. The record-verification path is Apache-2.0. A commercial licence is available on request.**

The verification path is permissive on purpose: a laboratory that shows a Kionel
record in an audit must be able to check it years later, without us and without
taking on AGPL obligations.

The boundary is drawn **per package** and runs one way:

- `@kionel/crypto` (Apache-2.0) — record types, format checks, the encoders that
  produce the signed canonical bytes, and **every `verify*` function**.
- `@kionel/issue` (AGPL-3.0) — session set-up and **record production**:
  `issueDispatch`, `issueReceipt`, `endorse`, `issueAuditEntry`,
  `issueMethodRelease` and their v2 counterparts.

Production may call verification; verification never calls production. The
dependency direction is tested in `tools/tests/licensing.test.ts`.

## Apache License 2.0

Full text: [LICENSE-APACHE](LICENSE-APACHE)

| Path | What it does |
|---|---|
| `packages/platform-keys/` | Key policy and signing interfaces |
| `packages/crypto/` | Record types, canonical encoders and all signature **verification** |
| `packages/attestation-core/` | X.509 chain verification and DER reader |
| `packages/timestamp/` | RFC 3161 timestamp verification |
| `apps/verify/` | Offline receipt verifier CLI |
| `apps/audit/` | Audit ledger verifier CLI |

## GNU Affero General Public License v3.0

Full text: [LICENSE](LICENSE)

Everything not listed above, including:

| Path | What it does |
|---|---|
| `packages/core/` | Frame format and fountain code |
| `packages/transport-qr/`, `packages/transport-color-grid/` | Optical transports |
| `packages/issue/` | Session set-up and record **production** |
| `packages/sdk/` | Integration API |
| `packages/enterprise/`, `packages/control-plane/` | Enrolment, revocation and management |
| `packages/attestation-{android,apple,windows}/` | Device attestation verifiers |
| `packages/licensing/`, `apps/license/` | Signed licence files, kept for commercial licensees (the open edition never asks for one) |
| `packages/lab-workflows/` | Sample list reconciliation |
| `apps/commerce/` | kionel.com site worker: assets, timestamp relay, contact form (the folder keeps its historical name; it sells nothing) |
| `apps/web/` | The transfer app and the website |
| `apps/attest/` | Record production CLI |
| `native/` | Windows and Android native components |

If you change Kionel and distribute it, or run a changed version as a network
service for others, the AGPL requires you to publish that version's source under
the same licence.

## Commercial licence

For products or services that embed Kionel without publishing their source, or
organisations that cannot meet the AGPL's obligations. See [COMMERCIAL.md](COMMERCIAL.md).

## Name and logo

No licence grants rights to the "Kionel" name or logo beyond describing the
project accurately. A changed version should not be presented as the original.

## Contributions

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are accepted under terms
that keep the commercial licence possible.

## Licensor

The licensor is **Taha Bayar**, a sole proprietorship registered in Türkiye
(şahıs işletmesi). Licensing questions: `legal@luminadigitale.com`.

A one-person vendor is a real continuity risk for an institutional user. The
answer is technical: the verification path is permanently Apache-2.0, and the
whole product is now open source, so records stay verifiable and the software
stays usable even if the vendor disappears.
