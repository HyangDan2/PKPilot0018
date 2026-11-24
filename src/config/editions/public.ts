/* Public edition — the current HD2Lab Sigrún build. Every value here reproduces
   the behaviour, brand and storage keys the live site already has. */

import type { ProductEdition } from '../product';

export const PUBLIC_EDITION: ProductEdition = {
  PRODUCT_ID: 'pkpilot0018',
  EDITION_ID: 'public',
  APP_NAME: 'HD2Lab Sigrún',
  APP_NAME_LOCAL: '시그룬',
  APP_VERSION: '1.0.0',
  APP_PHASE: 'Phase 3',
  BRAND_NAME: 'HD2Lab',
  COPYRIGHT: '© HD2Lab',
  BASE_PATH: '/PKPilot0018/',
  CANONICAL_URL: 'https://hyangdan2.github.io/PKPilot0018/',
  // Empty: the public keys stay exactly as previous builds wrote them.
  STORAGE_NAMESPACE: '',
  EXPORT_FILE_PREFIX: 'sigrun',
  EXTERNAL_LINKS_ENABLED: true,
  SUMMARY: 'Pure-browser statistical and quality workspace: descriptive statistics, hypothesis tests, ANOVA, regression, control charts and process capability.',
  DESCRIPTION: "Sigrún is HD2Lab's pure-browser statistical and quality workspace: descriptive statistics, hypothesis tests, ANOVA with Tukey, regression with residual diagnostics, control charts with Nelson rules, process capability, Pareto, and interactive SVG charts. No backend, no install.",
  OG_IMAGE: 'https://hyangdan2.github.io/PKPilot0018/og-image.png',
};
