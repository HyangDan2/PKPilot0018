/* Public edition — Statelia, the HD2Lab statistical engineering suite.

   The public product is Statelia and its engine is Sigrdrifa Engine.
   Everything the statistical engine, the project schema and the storage keys
   depend on is unchanged: the storage namespace stays empty, so every key a
   previous build wrote is read here as before, and the project format keeps its
   `sigrun-project` name for files written by those builds. */

import type { ProductEdition } from '../product';

export const PUBLIC_EDITION: ProductEdition = {
  PRODUCT_ID: 'pkpilot0018',
  EDITION_ID: 'public',
  APP_NAME: 'Statelia',
  APP_NAME_LOCAL: '스타텔리아',
  APP_VERSION: '1.0.0',
  APP_PHASE: 'Phase 3',
  PRODUCT_CATEGORY: 'Statistical Engineering Suite',
  ENGINE_NAME: 'Sigrdrifa Engine',
  ENGINE_VERSION: 'v1.0',
  BRAND_NAME: 'HD2Lab',
  SLOGAN: 'Beyond Dimensions',
  COPYRIGHT: '© HD2Lab',
  BASE_PATH: '/PKPilot0018/',
  CANONICAL_URL: 'https://hyangdan2.github.io/PKPilot0018/',
  REPOSITORY_URL: 'https://github.com/HyangDan2/PKPilot0018',
  HOMEPAGE_URL: 'https://hyangdan2.github.io/',
  // FIX-02: the one public enquiry address. The personal mailbox is never used.
  CONTACT_EMAIL: 'hyperdimensionaldesignlab@gmail.com',
  // Empty: the public keys stay exactly as previous builds wrote them.
  STORAGE_NAMESPACE: '',
  EXPORT_FILE_PREFIX: 'statelia',
  EXTERNAL_LINKS_ENABLED: true,
  SUMMARY: 'Professional statistical analysis, engineering modeling, process quality control and multi-response optimization, computed entirely in the browser.',
  DESCRIPTION: "Statelia is HD2Lab's pure-browser statistical engineering suite: descriptive statistics, hypothesis tests, ANOVA with Tukey, regression with residual diagnostics, control charts with Nelson rules, process capability, DOE/RSM, multi-response optimization and interactive SVG charts. Powered by Sigrdrifa Engine. No backend, no install.",
  // WO-B02: 1200×630 card derived from the official Statelia splash artwork.
  OG_IMAGE: 'https://hyangdan2.github.io/PKPilot0018/branding/statelia-og.webp',
};
