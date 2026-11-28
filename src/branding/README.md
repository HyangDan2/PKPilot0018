# Statelia brand assets (WO-B02)

The images in this folder are the product owner's official artwork. They are
**never generated, redrawn or replaced by another logo** in this repository.

Drop the approved files here, keeping the names below, and the application picks
them up at the next build (Vite hashes them for the hosted build and inlines
them into the portable single file):

| File | Used by |
| --- | --- |
| `statelia-splash.webp` | startup splash artwork (or `statelia-splash.png`) |
| `statelia-symbol.png` | square symbol above the wordmark, favicon source |
| `statelia-logo.png` | horizontal wordmark (About, docs) |
| `sigrdrifa-engine-logo.png` | engine line in About (`Sigrdrifa Engine v1.0`) |
| `hd2lab-logo.png` | owner wordmark (`HD²LAB`, `Beyond Dimensions`) |
| `statelia-og.webp` | 1200×630 social card (`public/branding/statelia-og.webp` for the URL form) |

Until a file arrives the UI renders its **text fallback** instead — the
component never shows a stand-in image, and never fails to start because an
image is missing.

`src/branding/assets.ts` is the only place that reads this folder.
