/*! Everloot tooltips, AGPL-3.0-only. No cookies or tracking. */
(function () {
  "use strict";
  var D = document, W = window;
  if (W.__everlootTooltips) return;
  W.__everlootTooltips = 1;

  var ORIGIN = "https://everloot.app", cs = D.currentScript;
  try { if (cs && cs.src) ORIGIN = new URL(cs.src).origin; } catch (e) { /* keep the default */ }
  var HOST = new URL(ORIGIN).host;
  var TYPES = { items: "item", npcs: "npc", quests: "quest", objects: "object" };
  var PATH = /^\/database\/(items|npcs|quests|objects)\/([1-9]\d{0,9})(?:-[^/]*)?\/?$/;
  var CSS =
    ".b{all:initial;position:fixed;box-sizing:border-box;width:max-content;max-width:min(320px,calc(100vw - 16px));padding:8px 10px;" +
    "font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;color:#e8e4d0;background:#0a0a0f;border:1px solid #3d3a2e;" +
    "border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.5);animation:f .12s ease-out}" +
    "@keyframes f{from{opacity:0}}@media (prefers-reduced-motion:reduce){.b{animation:none}}" +
    ".h{display:flex;gap:8px;align-items:flex-start}.i{width:36px;height:36px;flex:none;border:1px solid #3d3a2e;border-radius:3px}" +
    ".t{font-weight:600;font-size:14px;overflow-wrap:anywhere}.y{color:#ffd100}.m{color:#8a8a8a;font-size:11px;margin-top:4px}" +
    ".o{display:block;margin-top:6px;font:11px ui-monospace,Menlo,Consolas,monospace;color:#8a8a8a}" +
    "a{display:inline-block;margin-top:6px;color:#ffd100;font-size:12px}";

  var host, root, box, cur, armed, showT, hideT, described, prev, touched, cache = {}, done = {};

  function ok(url) {
    // Only https, or the script's own site (http://localhost while developing).
    try { var u = new URL(url); return u.protocol === "https:" || u.origin === ORIGIN ? u : null; } catch (e) { return null; }
  }

  // What a link points at: { type, id, key }, or null for any link that is not an everloot.app page we have a card for.
  function match(a) {
    if (!a || typeof a.href !== "string" || a.getAttribute("data-everloot-tooltip") === "off") return null;
    var u = ok(a.href), m;
    if (!u || (u.host !== "everloot.app" && u.host !== "www.everloot.app" && u.host !== HOST)) return null;
    m = PATH.exec(u.pathname);
    return m ? { key: TYPES[m[1]] + "/" + m[2] } : null;
  }

  function linkOf(e) {
    var p = e.composedPath ? e.composedPath() : [e.target], i;
    for (i = 0; i < p.length; i++) if (p[i] && p[i].tagName === "A") return p[i];
    return null;
  }

  function inCard(e) {
    return !!host && (e.composedPath ? e.composedPath() : [e.target]).indexOf(host) >= 0;
  }

  function load(m) {
    var k = m.key;
    return cache[k] || (cache[k] = fetch(ORIGIN + "/api/tooltip/" + k, { credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return (done[k] = d && d.ok === true ? d : null); })
      .catch(function () { delete cache[k]; return null; }));
  }

  function el(tag, cls, text) {
    var n = D.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function mount() {
    if (host) return;
    host = el("div");
    host.id = "everloot-tooltip";
    host.setAttribute("role", "tooltip");
    host.style.cssText = "all:initial;position:fixed;top:0;left:0;z-index:2147483647";
    root = host.attachShadow({ mode: "open" });
    try {
      var s = new CSSStyleSheet();
      s.replaceSync(CSS);
      root.adoptedStyleSheets = [s];
    } catch (e) {
      root.appendChild(el("style", "", CSS)); // no constructable sheets: a <style> works unless the host's CSP forbids it
    }
    box = el("div", "b");
    box.style.display = "none";
    root.appendChild(box);
    D.body.appendChild(host);
  }

  // Every string from the server goes in as text, never as markup.
  function render(d) {
    var head = el("div", "h"), body = el("div"), title = el("div", "t", String(d.title)), g = d.gameData, icon = d.icon && ok(d.icon), url = d.url && ok(d.url), color = /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : "", i, line, a;
    box.textContent = "";
    if (icon) {
      var img = el("img", "i");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = icon.href;
      img.style.borderColor = color; // the quality colour, as the name
      head.appendChild(img);
    }
    title.style.color = color;
    body.appendChild(title);
    for (i = 0; i < (d.lines || []).length; i++) {
      line = String(d.lines[i]);
      if (line === "Help confirm these values: install the addon at /addon.") {
        a = el("a", "", "Help confirm these values: install the addon.");
        a.href = ORIGIN + "/addon";
        a.target = "_blank";
        a.rel = "noopener";
        body.appendChild(a);
        continue;
      }
      body.appendChild(el("div", line.charAt(0) === '"' ? "y" : "", line));
    }
    head.appendChild(body);
    box.appendChild(head);
    if (g) box.appendChild(el("div", "m", String(g.label) + " · build " + String(g.build)));
    if (url && (url.host === "everloot.app" || url.host === "www.everloot.app" || url.host === HOST)) {
      a = el("a", "", "Open on everloot.app");
      a.href = url.href;
      a.target = "_blank";
      a.rel = "noopener";
      box.appendChild(a);
    }
    if (g && g.credit) box.appendChild(el("span", "o", String(g.credit)));
  }

  function place(a) {
    var r = a.getBoundingClientRect(), vw = D.documentElement.clientWidth, vh = D.documentElement.clientHeight;
    var w = box.offsetWidth, h = box.offsetHeight, y = r.bottom + 8;
    if (y + h > vh - 8 && r.top - h - 8 >= 8) y = r.top - h - 8;
    box.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
    box.style.top = Math.max(8, y) + "px";
  }

  function hide() {
    clearTimeout(showT);
    clearTimeout(hideT);
    if (described) {
      if (prev === null) described.removeAttribute("aria-describedby");
      else described.setAttribute("aria-describedby", prev);
      described = null;
    }
    cur = null;
    if (box) box.style.display = "none";
  }

  function show(a, m) {
    cur = a;
    load(m).then(function (d) {
      if (cur !== a || !d) return;
      mount();
      render(d);
      box.style.display = "block";
      place(a);
      prev = a.getAttribute("aria-describedby");
      described = a;
      a.setAttribute("aria-describedby", prev ? prev + " " + host.id : host.id);
    });
  }

  function enter(a, delay) {
    var m = match(a);
    clearTimeout(hideT);
    if (!m || cur === a) return;
    hide();
    cur = a;
    showT = setTimeout(function () { show(a, m); }, delay);
  }

  function leave() {
    clearTimeout(hideT);
    hideT = setTimeout(hide, 200);
  }

  function on(type, fn) { D.addEventListener(type, fn, true); }

  on("pointerover", function (e) {
    if (e.pointerType === "touch") return;
    var a = linkOf(e);
    if (a) enter(a, 150);
    else if (inCard(e)) clearTimeout(hideT);
  });
  on("pointerout", function (e) {
    if (e.pointerType !== "touch" && (inCard(e) || match(linkOf(e)))) leave();
  });
  on("focusin", function (e) {
    var a = linkOf(e);
    if (a) enter(a, 0);
  });
  on("focusout", function (e) {
    if (match(linkOf(e))) leave();
  });
  on("keydown", function (e) {
    touched = false;
    if (e.key === "Escape") hide();
  });
  on("pointerdown", function (e) {
    touched = e.pointerType === "touch";
  });
  // Touch: the first tap shows the card, the second follows the link. A tap anywhere else closes it.
  on("click", function (e) {
    if (inCard(e)) return;
    var a = linkOf(e), m = a && match(a);
    if (touched && m && armed !== a && done[m.key] !== null && !(e.ctrlKey || e.metaKey || e.shiftKey || e.button)) {
      e.preventDefault();
      armed = a;
      enter(a, 0);
      return;
    }
    armed = null;
    if (!a) hide();
  });
  W.addEventListener("scroll", hide, { passive: true, capture: true });
  W.addEventListener("resize", hide);
})();
