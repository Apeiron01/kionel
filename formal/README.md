# Formal models of the Kionel transfer protocols

Symbolic models of the three ways Kionel moves a file, checked with
[ProVerif](https://bblanche.gitlabpages.inria.fr/proverif/) 2.05. Each model is
written by hand from the implementation it names; it is not extracted from the code.

```
PROVERIF=/path/to/proverif pnpm prove
```

The runner checks every query against an expected result. It also runs **sanity
variants** that remove one assumption. In those variants ProVerif must find the
attack; if it did not, the model would not be measuring what it claims.

## Results

| Model | Variant | Secrecy of the file | Authentication | Receipt soundness |
|---|---|---|---|---|
| `kionel-v1.pv` two-way handshake | codes compared; both identity keys leak afterwards | **holds** (incl. forward secrecy) | **holds** (injective) | **holds** |
| `kionel-v1.pv` | codes NOT compared (sanity) | attack found | attack found | holds |
| `kionel-oneway-code.pv` typed one-time code | — | **holds** while the code is unknown | **holds** | — |
| `kionel-oneway-code.pv` | offline guessing of the code | possible (expected) | — | — |
| `kionel-oneway-card.pv` receiver card | card installed over a trusted route | **holds** | **holds** | — |
| `kionel-oneway-card.pv` | card sent over the attacker's channel (sanity) | attack found | holds | — |
| `kionel-oneway-card.pv` | receiver's long-term key leaks later | **fails** (no forward secrecy) | holds | — |

What the properties mean:

- **Secrecy:** an attacker who controls the optical channel — reads every frame,
  replays, drops, and shows its own codes to either camera — does not learn the file.
- **Authentication:** if the receiver accepts a file from a device key, that device
  sent that file (to that receiver, once, for the two-way protocol).
- **Receipt soundness:** if an auditor verifies a delivery receipt against two
  device keys, the receiver really accepted a file with that hash from that sender.

## Assumptions, stated

- **The operator compares the codes** on both screens (two-way). This is the only
  authentic channel; without it the model finds a person-in-the-middle attack.
- **The code is typed only on the intended PC** and shown only on the receiver
  (one-way code). ProVerif confirms the code can be guessed offline by someone who
  recorded the screen; the cost is 2^60 candidates × 600,000 PBKDF2-SHA256 rounds.
- **The receiver card reaches the PC over a route the organisation trusts** (card
  mode). Over an untrusted route an attacker substitutes its own card.
- The primitives are ideal: Ed25519 signatures cannot be forged, X25519 is
  Diffie-Hellman, HKDF/PBKDF2/SHA-256 behave as random functions, AES-256-GCM is
  authenticated encryption.

## What these models do not prove

- **That the code matches the model.** Bugs in the implementation — parsing,
  memory, browser APIs — are outside it. This is not an implementation audit.
- **Bit lengths.** A symbolic model cannot count bits: the 20 + 25-bit comparison
  codes, the 60-bit typed code and the 128-bit key confirmation are treated as
  unguessable, except where `weaksecret` is used.
- **The timestamp window** on handshake records, the QR framing and the fountain
  code are not modelled; replay protection in the model comes from fresh nonces.
- **Who the person is.** Signatures identify devices, not people.
- **Side channels,** a compromised device, or a camera filming both screens.

An independent review of the implementation is still outstanding; see the
security page for current status.
