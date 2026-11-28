/* Enterprise edition — derived product for a closed network.

   The owner's company name, logo and copyright line are NOT guessed here: they
   must be supplied and approved by the customer (WO-FINAL-001 · WO-04). Until
   then BRAND_NAME and COPYRIGHT stay empty, and the release check reports them
   as blockers instead of shipping an invented brand.

   STORAGE_NAMESPACE keeps this build's IndexedDB database, autosave, settings,
   workspace, chart styles and tutorial records apart from the public edition
   even on the same origin. Public data is never read or deleted from here. */

import type { ProductEdition } from '../product';

export const ENTERPRISE_EDITION: ProductEdition = {
  PRODUCT_ID: 'sigrun-enterprise',
  EDITION_ID: 'enterprise',
  APP_NAME: 'Sigrún Enterprise',
  APP_NAME_LOCAL: '시그룬 엔터프라이즈',
  APP_VERSION: '1.0.0',
  APP_PHASE: 'Phase 3',
  PRODUCT_CATEGORY: 'Statistical Workspace',
  ENGINE_NAME: 'Sigrdrifa Engine',
  ENGINE_VERSION: 'v1.0',
  BRAND_NAME: '',
  SLOGAN: '',
  COPYRIGHT: '',
  REPOSITORY_URL: '',
  HOMEPAGE_URL: '',
  // FIX-02: an internal edition publishes no public address, so the public
  // enquiry mailbox never reaches a closed-network build.
  CONTACT_EMAIL: '',
  BASE_PATH: '/',
  CANONICAL_URL: '',
  STORAGE_NAMESPACE: 'sigrun.enterprise.',
  EXPORT_FILE_PREFIX: 'sigrun-enterprise',
  EXTERNAL_LINKS_ENABLED: false,
  SUMMARY: 'Offline statistical workspace for closed networks: every analysis runs in the browser, with no backend, network or API key.',
  DESCRIPTION: 'Offline statistical workspace for closed networks: descriptive statistics, hypothesis tests, ANOVA, regression, control charts, process capability and Pareto charts, all computed in the browser with no backend, network or API key.',
  OG_IMAGE: '',
};
