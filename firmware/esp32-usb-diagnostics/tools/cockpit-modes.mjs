// SPDX-License-Identifier: MIT
/** Split entry and cache ownership; game bytes are requested only in Game Mode. */
export function splitCockpitModes(entries, extensionPaths) {
  const scripts = extensionPaths.filter(p => p.endsWith('.js'));
  const styles = extensionPaths.filter(p => p.endsWith('.css'));
  if (scripts.length !== 1 || styles.length !== 1) throw new Error('Unexpected drone entry outputs');
  const game = entries.get('index.html').toString();
  entries.set('game.webmanifest', entries.get('manifest.webmanifest'));
  entries.set('game.html', Buffer.from(game.replace('./manifest.webmanifest', './game.webmanifest')
    .replace('</body>', '<a href="/gamexr/" style="position:fixed;left:12px;bottom:24px;z-index:90;padding:10px 14px;border-radius:10px;background:#123c43;color:#e3f4ff;text-decoration:none;font:13px system-ui">Wi-Fi Drone</a></body>')));
  entries.set('index.html', Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#070d17"><meta name="description" content="GameXR Wi-Fi drone controls and live telemetry.">
<link rel="icon" href="/gamexr/icons/gamexr.svg" type="image/svg+xml"><link rel="manifest" href="/gamexr/manifest.webmanifest">
<link rel="stylesheet" href="/gamexr/${styles[0]}"><script type="module" src="/gamexr/${scripts[0]}"></script>
<title>GameXR — Wi-Fi Drone</title></head><body><main id="app" aria-busy="true"></main><noscript>Enable JavaScript to use drone controls.</noscript></body></html>`));
  const manifest = JSON.parse(entries.get('manifest.webmanifest'));
  manifest.name = 'GameXR Wi-Fi Drone'; manifest.short_name = 'Wi-Fi Drone';
  manifest.description = 'Local drone controls and telemetry';
  entries.set('manifest.webmanifest', Buffer.from(JSON.stringify(manifest)));
  return ['index.html', 'manifest.webmanifest', 'icons/gamexr.svg', ...extensionPaths];
}
