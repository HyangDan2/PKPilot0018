export interface LicenseFileText {
  file: string;
  text: string;
}

export interface LicenseRow {
  name: string;
  version: string;
  license: string;
  url: string;
  texts: LicenseFileText[];
  notices: LicenseFileText[];
}

export const FIRST_PARTY_NOTE: string[];

export function installedPackages(root: string): string[];

export function licenseOf(manifest: Record<string, unknown>): string;

export function packageLicense(dir: string): LicenseRow;

export function collectLicenses(root: string): { rows: LicenseRow[]; problems: string[] };

export function licensesText(
  rows: LicenseRow[],
  options?: { version?: string; description?: string; firstParty?: string[] },
): string;
