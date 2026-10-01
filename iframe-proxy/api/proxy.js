// Vercel serverless version of the pyrite proxy.
// Deploy the whole `iframe-proxy/` folder to Vercel (free, no custom domain).
// Frontend: /index.html, proxy: /api/proxy?url=https://example.com
// Single domain, so school wifi only needs to allow *.vercel.app.

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(204).end();
  }

  const targetStr = req.query.url;
  if (!targetStr) {
    setCors(res);
    return res.status(400).json({ error: "Missing ?url=https://example.com" });
  }

  let target;
  try {
    target = new URL(targetStr);
  } catch {
    setCors(res);
    return res.status(400).json({ error: "Invalid url param" });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    setCors(res);
    return res.status(400).json({ error: "Only http/https allowed" });
  }

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proxyBase = `${proto}://${host}/api/proxy?url=`;

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: req.method === "GET" || req.method === "HEAD" ? "GET" : req.method,
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
        accept: req.headers.accept || "text/html",
        "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9",
        referer: target.origin + "/",
      },
      redirect: "follow",
    });
  } catch (e) {
    setCors(res);
    return res.status(502).json({ error: "Upstream fetch failed: " + e.message });
  }

  setCors(res);
  const contentType = upstream.headers.get("content-type") || "";
  // copy safe headers through (skip framing/csp/length)
  for (const [k, v] of upstream.headers) {
    const lk = k.toLowerCase();
    if (["x-frame-options", "content-security-policy", "content-security-policy-report-only", "cross-origin-opener-policy", "cross-origin-embedder-policy", "cross-origin-resource-policy", "content-length", "content-encoding"].includes(lk)) continue;
    if (lk.startsWith("cf-") || lk.startsWith("vercel-")) continue;
    try { res.setHeader(k, v); } catch {}
  }

  if (contentType.includes("text/html")) {
    let text = await upstream.text();
    text = rewriteNavAttrs(text, target, proxyBase);
    const baseDir = target.origin + target.pathname.substring(0, target.pathname.lastIndexOf("/") + 1);
    const inject = `<base href="${baseDir}"><script>${buildInterceptor(proxyBase)}</script>`;
    if (/<head[^>]*>/i.test(text)) {
      text = text.replace(/<head[^>]*>/i, (m) => `${m}${inject}`);
    } else {
      text = inject + text;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.status(upstream.status).send(text);
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  return res.status(upstream.status).send(buf);
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

function toProxiedHref(val, target, proxyBase) {
  if (!val) return null;
  val = val.trim();
  if (!val || val[0] === "#") return null;
  if (/^(javascript|mailto|tel|data|blob):/i.test(val)) return null;
  try {
    const abs = new URL(val, target.toString()).toString();
    const proto = new URL(abs).protocol;
    if (proto !== "http:" && proto !== "https:") return null;
    return proxyBase + encodeURIComponent(abs);
  } catch {
    return null;
  }
}

function rewriteNavAttrs(html, target, proxyBase) {
  html = html.replace(/<(a|area)(\s[^>]*?)href\s*=\s*(["'])(.*?)\3/gi, (m, tag, pre, q, val) => {
    const r = toProxiedHref(val, target, proxyBase);
    return r ? `<${tag}${pre}href=${q}${r}${q}` : m;
  });
  html = html.replace(/<form(\s[^>]*?)action\s*=\s*(["'])(.*?)\2/gi, (m, pre, q, val) => {
    const r = toProxiedHref(val, target, proxyBase);
    return r ? `<form${pre}action=${q}${r}${q}` : m;
  });
  html = html.replace(/<(button|input)(\s[^>]*?)formaction\s*=\s*(["'])(.*?)\3/gi, (m, tag, pre, q, val) => {
    const r = toProxiedHref(val, target, proxyBase);
    return r ? `<${tag}${pre}formaction=${q}${r}${q}` : m;
  });
  html = html.replace(/<(iframe|frame)(\s[^>]*?)src\s*=\s*(["'])(.*?)\3/gi, (m, tag, pre, q, val) => {
    const r = toProxiedHref(val, target, proxyBase);
    return r ? `<${tag}${pre}src=${q}${r}${q}` : m;
  });
  html = html.replace(/(<meta[^>]*?content\s*=\s*["']\s*\d+\s*;\s*url=)([^"']+)(["'])/gi, (m, pre, val, q) => {
    const r = toProxiedHref(val, target, proxyBase);
    return r ? `${pre}${r}${q}` : m;
  });
  return html;
}

function buildInterceptor(proxyBase) {
  return `(function(){var PROXY=${JSON.stringify(proxyBase)};`
    + `function toP(u){try{var abs=new URL(u,document.baseURI).toString();if(abs.indexOf(PROXY)===0)return abs;var p=new URL(abs);if(p.protocol!=="http:"&&p.protocol!=="https:")return null;return PROXY+encodeURIComponent(abs)}catch(e){return null}}`
    + `function fixEl(el){try{if(el.tagName==="A"||el.tagName==="AREA"){var h=el.getAttribute("href");if(h&&h.charAt(0)!=="#"&&!/^(javascript|mailto|tel|data|blob):/i.test(h)){var r=toP(h);if(r&&el.href!==r)el.setAttribute("href",r)}}else if(el.tagName==="FORM"){var a=el.getAttribute("action");if(a){var ra=toP(a);if(ra)el.action=ra}}else if(el.tagName==="IFRAME"||el.tagName==="FRAME"){var s=el.getAttribute("src");if(s){var rs=toP(s);if(rs&&el.src!==rs)el.setAttribute("src",rs)}}else if(el.tagName==="BUTTON"||el.tagName==="INPUT"){var fa=el.getAttribute("formaction");if(fa){var rf=toP(fa);if(rf)el.setAttribute("formaction",rf)}}}catch(e){}}`
    + `function sweep(root){try{var q=root.querySelectorAll?root.querySelectorAll("a[href],area[href],form[action],iframe[src],frame[src],button[formaction],input[formaction]"):[];for(var i=0;i<q.length;i++)fixEl(q[i]);if(root!==document&&root.setAttribute)fixEl(root)}catch(e){}}`
    + `sweep(document);`
    + `if(window.MutationObserver){var mo=new MutationObserver(function(muts){for(var i=0;i<muts.length;i++){var m=muts[i];for(var j=0;j<m.addedNodes.length;j++){var n=m.addedNodes[j];if(n.nodeType===1)sweep(n)}}});mo.observe(document.documentElement,{childList:true,subtree:true})}`
    + `function nav(r){location.href=r}`
    + `function onLink(e){var a=e.target&&e.target.closest?e.target.closest('a[href],area[href]'):null;if(!a)return;var href=a.getAttribute("href");if(!href||href.charAt(0)==="#"||/^(javascript|mailto|tel|data|blob):/i.test(href))return;var r=toP(href);if(!r)return;if(a.target==="_blank"){e.preventDefault();window.open(r,"_blank");return} e.preventDefault();nav(r)}`
    + `document.addEventListener("click",onLink,true);document.addEventListener("auxclick",onLink,true);`
    + `document.addEventListener("submit",function(e){var f=e.target;if(!f||f.tagName!=="FORM")return;var sub=e.submitter&&e.submitter.getAttribute?e.submitter.getAttribute("formaction"):null;var act=sub||f.getAttribute("action")||document.baseURI;var method=(f.method||"get").toLowerCase();if(method==="get"){e.preventDefault();try{var base=new URL(act,document.baseURI).toString();var u=new URL(base);var fd=new FormData(f);fd.forEach(function(v,k){u.searchParams.append(k,v)});var r=toP(u.toString());if(r)nav(r)}catch(err){var r2=toP(act);if(r2)nav(r2)}}else{var r3=toP(act);if(r3)f.action=r3}},true);`
    + `var _open=window.open;window.open=function(u,n,s){if(typeof u==="string"){var r=toP(u);if(r)u=r}return _open.call(this,u,n,s)};`
    + `if(window.history){try{var _ps=history.pushState,_rs=history.replaceState;history.pushState=function(a,b,u){if(typeof u==="string"){var r=toP(u);if(r)u=r}return _ps.call(this,a,b,u)};history.replaceState=function(a,b,u){if(typeof u==="string"){var r=toP(u);if(r)u=r}return _rs.call(this,a,b,u)}}catch(e){}}`
    + `if(window.fetch){var _f=window.fetch;window.fetch=function(i,init){try{if(typeof i==="string"){var r=toP(i);if(r)i=r}else if(i&&i.url){var r2=toP(i.url);if(r2)i=new Request(r2,i)}}catch(e){}return _f.call(this,i,init)}};`
    + `if(window.XMLHttpRequest){var _x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,a,b,c){try{var r=toP(u);if(r)u=r}catch(e){}return _x.call(this,m,u,a,b,c)}};`
    + `try{if(window.top!==window.self){Object.defineProperty(window,"top",{value:window.self});Object.defineProperty(window,"parent",{value:window.self})}}catch(e){}})();`;
}
