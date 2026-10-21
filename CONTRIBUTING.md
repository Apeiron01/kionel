# Contributing

Issues, questions and pull requests are welcome.

## Before you open a pull request

- Run `pnpm install`, `pnpm typecheck` and `pnpm test`. All tests must pass.
- Keep the licence boundary: code under `packages/crypto`, `packages/platform-keys`,
  `packages/attestation-core`, `packages/timestamp`, `apps/verify` and `apps/audit`
  is Apache-2.0 and must never import record-production code. `tools/tests/licensing.test.ts`
  checks this.
- Security issues: do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Licence of contributions

Kionel is offered under the AGPL-3.0 and, separately, under commercial licences
([COMMERCIAL.md](COMMERCIAL.md)). To keep both possible, every contribution must
come with the following grant. By submitting a pull request you agree that:

1. you wrote the contribution, or have the right to submit it;
2. it is licensed to the project under the licence of the files it changes
   (AGPL-3.0 or Apache-2.0);
3. you also grant Taha Bayar, the licensor, a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable licence to use, modify and distribute the contribution
   under other licence terms, including commercial ones.

Add this line to your pull request description to confirm it:

```
I agree to the contribution terms in CONTRIBUTING.md.
```
