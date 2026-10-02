# pyrite

simple iframe proxy + minimal browser ui. made for personal use.

live version: https://pyrite-proxy.pages.dev/iframe-proxy

paste a url, it loads inside the page even if the site normally blocks iframing.

## what it does

some sites send headers like `X-Frame-Options` or `Content-Security-Policy: frame-ancestors`
that tell your browser "do not let anyone embed me". pyrite runs everything
through a small serverless proxy that:

1. fetches the site for you (server side, so embed headers never reach your browser)
2. strips `X-Frame-Options`, `Content-Security-Policy`, `Cross-Origin-Opener-Policy`,
   `Cross-Origin-Embedder-Policy` and friends
3. injects a `<base>` tag so relative images / css / js still load
4. rewrites links and forms (`a`, `area`, `form`, `iframe`, `meta refresh`) to
   `.../api/proxy?url=...` so clicks stay inside the proxy
5. injects a small script that catches dynamic links, middle-clicks, `window.open`,
   `fetch`, `XHR`, `pushState` and search forms, same idea, for pages that
   render links with js

nothing fancy. if a site needs login, captcha, or heavy bot checks, it will
probably still break. that is normal for this kind of proxy.

## the ui

single file: `iframe-proxy/index.html`. monospace (jetbrains mono), dark / light.

- address bar + search (default duckduckgo)
- back / fwd / reload / home
- saved menu: bookmarks + history, stored in localstorage only
- settings drawer:
  - worker url (where your `/api/proxy` lives) + test button
  - theme, accent color, animations toggle
  - search engine, force https, allow forms / popups, open in about:blank
  - tab cloak (classroom / docs / drive / canvas / custom) + tab icon changes
    with the cloak, panic key + panic url
  - export / import / reset settings as json
- about:blank cloak button, fullscreen button
- keyboard: `ctrl+k` focuses the bar, `esc` closes menus

no accounts, no tracking. bookmarks and history never leave your browser.

## repo layout

- `iframe-proxy/index.html` - the whole frontend
- `iframe-proxy/worker.js` - cloudflare worker version (`?url=...`)
- `iframe-proxy/functions/api/proxy.js` - cloudflare pages function version (`/api/proxy?url=...`)
- `iframe-proxy/api/proxy.js` - vercel serverless version (backup host)
- `iframe-proxy/wrangler.toml` - worker config
- `iframe-proxy/vercel.json` - vercel config

the live site above uses the pages function, so the frontend and the proxy
are on the same domain. that is intentional, fewer domains to get blocked.

## run it

easiest: just open the live link above.

to run your own copy on cloudflare pages (free):

1. push this repo to github
2. cloudflare dashboard > pages > create > connect to git
3. framework: none, build command: empty, output: `/`
   (if your repo root contains the `iframe-proxy/` folder, the app will be
   at `/iframe-proxy` exactly like the live link)
4. deploy, then open `https://<your-project>.pages.dev/iframe-proxy`
5. in settings > worker, set `https://<your-project>.pages.dev/api/proxy` and save

to run the worker version instead:

1. `npm i -g wrangler`, `wrangler login`
2. `cd iframe-proxy`, `wrangler deploy`
3. paste the `*.workers.dev` url into settings > worker

## notes

- only use this on sites you own or are allowed to embed. the headers it
  strips exist to stop clickjacking.
- `file://` works for clicking around, but set the worker url to an `https://`
  address, browsers block mixed content otherwise.
- if a page is blank, open devtools > network and look at the `?url=` request.
  usually the upstream site blocked the datacenter ip, not a bug here.

pyrite v0.3
