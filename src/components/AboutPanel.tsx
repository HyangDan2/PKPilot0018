import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { PRODUCT } from '../config/product';
import { aboutCategoryLine, aboutVersionLine } from '../lib/appInfo';
import { BUILD_COMMIT, BUILD_VERSION, buildDateLabel } from '../config/buildInfo';
import { firstBrandAsset } from '../branding/assets';
import { BrandBanner } from './Header';
import { IconExternal } from './Icons';

interface Props {
  lang: Lang;
}

/** The five areas WO-B04 asks the About panel to name. */
const FEATURES = ['about.feature.stat', 'about.feature.spc', 'about.feature.doe', 'about.feature.model', 'about.feature.viz'] as const;

/**
 * Help ▸ About Statelia (WO-B04).
 *
 * Every value is read from the build, not typed here: the product name and
 * category from the edition record, the engine from the same record, and the
 * commit and build day from the build metadata `vite` injects. Only the
 * feature names and the wording around them live in this file.
 */
export function AboutPanel({ lang }: Props) {
  const symbol = firstBrandAsset('statelia-symbol.png');
  const engineLogo = firstBrandAsset('sigrdrifa-engine-logo.png');
  const ownerLogo = firstBrandAsset('hd2lab-logo.png');

  return (
    <div className="help-body about-panel" data-testid="about-panel">
      <BrandBanner lang={lang} />

      <div className="about-identity">
        {symbol && <img className="about-symbol" src={symbol} alt="" aria-hidden="true" />}
        <div>
          <p className="about-product" data-testid="about-product">{aboutVersionLine(lang)}</p>
          <p className="about-category" data-testid="about-category">{PRODUCT.PRODUCT_CATEGORY}</p>
          <p className="about-engine" data-testid="about-engine">
            {engineLogo && <img className="about-engine-logo" src={engineLogo} alt="" aria-hidden="true" />}
            {t(lang, 'about.engine', { engine: PRODUCT.ENGINE_NAME, version: PRODUCT.ENGINE_VERSION })}
          </p>
        </div>
      </div>

      <p className="mono-note about-formerly">{t(lang, 'about.formerly')}</p>
      <p>{t(lang, 'about.text')}</p>

      <section className="about-section">
        <h4>{t(lang, 'about.features')}</h4>
        <ul className="about-features">
          {FEATURES.map((key) => <li key={key}>{t(lang, key)}</li>)}
        </ul>
      </section>

      <section className="about-section">
        <h4>{t(lang, 'about.build')}</h4>
        <table className="about-build">
          <tbody>
            <tr><th>{t(lang, 'about.buildVersion')}</th><td>v{BUILD_VERSION} · {PRODUCT.APP_PHASE} · {PRODUCT.EDITION_ID}</td></tr>
            <tr><th>{t(lang, 'about.commit')}</th><td className="mono-note" data-testid="about-commit">{BUILD_COMMIT}</td></tr>
            <tr><th>{t(lang, 'about.releaseDate')}</th><td className="mono-note">{buildDateLabel()}</td></tr>
            <tr><th>{t(lang, 'about.licenses')}</th><td>{t(lang, 'about.licensesValue')}</td></tr>
            <tr><th>{t(lang, 'about.limitations')}</th><td>{t(lang, 'about.limitationsValue')}</td></tr>
            {PRODUCT.EXTERNAL_LINKS_ENABLED && PRODUCT.REPOSITORY_URL && (
              <tr>
                <th>{t(lang, 'about.repository')}</th>
                <td>
                  <a className="about-link" href={PRODUCT.REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
                    {PRODUCT.REPOSITORY_URL.replace(/^https?:\/\//, '')} <IconExternal size={11} />
                  </a>
                </td>
              </tr>
            )}
            {PRODUCT.EXTERNAL_LINKS_ENABLED && PRODUCT.HOMEPAGE_URL && (
              <tr>
                <th>{t(lang, 'about.homepage')}</th>
                <td>
                  <a className="about-link" href={PRODUCT.HOMEPAGE_URL} target="_blank" rel="noopener noreferrer">
                    {PRODUCT.HOMEPAGE_URL.replace(/^https?:\/\//, '')} <IconExternal size={11} />
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="about-owner">
        {ownerLogo && <img className="about-owner-logo" src={ownerLogo} alt="" aria-hidden="true" />}
        <span>{t(lang, 'about.developed', { brand: PRODUCT.BRAND_NAME })}</span>
        {PRODUCT.SLOGAN && <span className="about-slogan">{PRODUCT.SLOGAN}</span>}
      </p>

      <p className="about-ai-note" data-testid="about-ai-note">{t(lang, 'about.aiNote')}</p>
    </div>
  );
}

/** The one-line identity under the Help ▸ About heading. */
export function aboutHeadline(): string {
  return aboutCategoryLine();
}
