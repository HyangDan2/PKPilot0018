import { useState } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { PRODUCT, PRODUCT_SHORT_NAME } from '../config/product';
import { aboutEngineLine } from '../lib/appInfo';
import { firstBrandAsset } from '../branding/assets';

/** How long the splash is shown at least (WO-B03: about 1.2 s). */
export const SPLASH_MIN_MS = 1200;
/** Fade-out length (WO-B03: 250–350 ms); zero when reduced motion is asked. */
export const SPLASH_FADE_MS = 320;
/** A restore that has not finished by then is reported instead of waiting. */
export const SPLASH_TIMEOUT_MS = 12000;

export type SplashPhase = 'showing' | 'leaving' | 'hidden';

interface Props {
  lang: Lang;
  phase: SplashPhase;
  error: boolean;
  onRetry: () => void;
}

/**
 * Statelia startup splash (WO-B03).
 *
 * The splash is a full-screen lid over a workspace that is initialising
 * underneath it: it never owns the restore, so a slow or failed restore is
 * reported here but is never caused by the splash. The official artwork is
 * shown as it was supplied when it is present; otherwise — and whenever the
 * image fails to load — the panel is the text wordmark. Nothing here draws or
 * recolours the brand.
 */
export function StartupSplash({ lang, phase, error, onRetry }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const artwork = imageFailed ? undefined : firstBrandAsset('statelia-splash.webp', 'statelia-splash.png');
  const symbol = imageFailed ? undefined : firstBrandAsset('statelia-symbol.png');

  return (
    <div
      className={`startup-splash ${phase}${error ? ' failed' : ''}${artwork ? ' has-art' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!error && phase !== 'hidden'}
      data-testid="startup-splash"
      data-phase={phase}
      data-art={artwork ? 'official' : 'fallback'}
    >
      {artwork && (
        <img
          className="startup-splash-art"
          src={artwork}
          alt=""
          aria-hidden="true"
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      )}

      {!artwork && (
        <div className="startup-splash-panel">
          {symbol && (
            <img
              className="startup-splash-symbol"
              src={symbol}
              alt=""
              aria-hidden="true"
              draggable={false}
              onError={() => setImageFailed(true)}
            />
          )}
          <p className="startup-splash-name" data-testid="startup-splash-name">{PRODUCT_SHORT_NAME}</p>
          <p className="startup-splash-category">{t(lang, 'brand.tag')}</p>
          <p className="startup-splash-engine">{aboutEngineLine()}</p>
        </div>
      )}

      {error ? (
        <div className="startup-splash-status" data-testid="startup-splash-error">
          <p className="startup-splash-error-title">{t(lang, 'splash.errorTitle')}</p>
          <p className="startup-splash-error-body">{t(lang, 'splash.errorBody')}</p>
          <button type="button" className="btn" onClick={onRetry} data-testid="startup-splash-retry">
            {t(lang, 'splash.retry')}
          </button>
        </div>
      ) : (
        <div className="startup-splash-status">
          <span className="startup-splash-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>{t(lang, 'splash.loading')}</span>
        </div>
      )}

      <p className="startup-splash-owner">
        {PRODUCT.BRAND_NAME}
        {PRODUCT.SLOGAN ? ` · ${PRODUCT.SLOGAN}` : ''}
      </p>
    </div>
  );
}
