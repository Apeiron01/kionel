// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseAnchors, validateCertificateChain } from "./chain.ts";

const fixture = (name: string) => readFileSync(
  new URL(`../../attestation-android/test-fixtures/${name}`, import.meta.url),
  "utf8",
);
const ROOT = fixture("root.crt");
const LEAF = fixture("strongbox.crt");
const OTHER_LEAF = fixture("other-challenge.crt");
const NOW = new Date();

test("pinned CA'ya çıkan zinciri kabul eder", () => {
  expect(validateCertificateChain([LEAF, ROOT], {
    anchors: parseAnchors([ROOT]), now: NOW, maxLength: 6,
  }).ok).toBe(true);
});

test("CA olmayan sertifika zincirde issuer veya trust anchor olamaz", () => {
  expect(validateCertificateChain([LEAF, OTHER_LEAF], {
    anchors: parseAnchors([ROOT]), now: NOW, maxLength: 6,
  })).toMatchObject({ ok: false, reason: "issuer-not-ca" });

  expect(validateCertificateChain([LEAF], {
    anchors: [new X509Certificate(LEAF)], now: NOW, maxLength: 6,
  })).toMatchObject({ ok: false, reason: "chain-not-anchored" });
});

test("yinelenen sertifika ile belirsiz zincir oluşturulamaz", () => {
  expect(validateCertificateChain([LEAF, ROOT, ROOT], {
    anchors: parseAnchors([ROOT]), now: NOW, maxLength: 6,
  })).toMatchObject({ ok: false, reason: "duplicate-certificate" });
});
