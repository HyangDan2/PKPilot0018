interface ImportMetaEnv {
  readonly VITE_EDITION?: string;
  readonly VITE_BUILD_YEAR?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_BASE_PATH?: string;
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
