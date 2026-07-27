/* ============================================================
   Konfide In One — x-dc minimal runtime (support.js)
   Renders Claude Design (.dc) templates in production:
   <x-dc> blocks, {{ bindings }}, <sc-for>, <sc-if>, events,
   DCLogic setState with structural-diff re-rendering.
   ============================================================ */
(function () {
  'use strict';

  var EVENTS = {
    onclick: 'click', onmouseenter: 'mouseenter', onmouseleave: 'mouseleave',
    onmouseover: 'mouseover', onmouseout: 'mouseout', oninput: 'input',
    onchange: 'change', onsubmit: 'submit', onkeydown: 'keydown',
    onkeyup: 'keyup', onfocus: 'focus', onblur: 'blur'
  };

  /* ===== Zoom the design canvas to exactly fill any viewport width =====
     The site is authored at a fixed 1440px width (original .dc.html files).
     We scale that canvas so it ALWAYS fills the available width — no left/right
     borders on large screens, no broken layout on small screens. Design is
     preserved 100% (just scaled). Media queries that re-flow the layout are
     stripped below so they never conflict with the zoom. */
  var DESIGN_W = 1440;
  var HERO_PX = /(?:^|;\s)height:\s*(?:\d{3,4})px/; // matches `height: 900px` etc, not `min-height`
  function fitDesign() {
    var w = document.documentElement.clientWidth || window.innerWidth;
    var h = window.innerHeight;
    /* Cap zoom at 1.0 — never enlarge beyond the authored 1440px design.
       On wider viewports the canvas centers (margin:0 auto) with seamless
       body bg; on narrower viewports it scales down to fit. This keeps the
       original design proportions on large screens instead of bloating them. */
    var z = Math.min(w / DESIGN_W, 1);
    var cs = document.querySelectorAll('div[style*="width: 1440px"], div[style*="width:1440px"]');
    for (var i = 0; i < cs.length; i++) cs[i].style.zoom = z;
    /* Only the FIRST hero (the actual first fold) is set to 100vh — so the
       above-the-fold stays full-bleed on any screen. Subsequent heroes keep
       their authored heights, preserving the original rhythm/proportions. */
    var heroes = document.querySelectorAll('div[style*="width: 100%; overflow: hidden"]');
    var firstHero = null;
    for (var j = 0; j < heroes.length; j++) {
      var s = heroes[j].getAttribute('style') || '';
      if (HERO_PX.test(s)) { firstHero = heroes[j]; break; }
    }
    if (firstHero) firstHero.style.height = (h / z) + 'px';
  }
  var rafT = null;
  window.addEventListener('resize', function () {
    if (rafT) cancelAnimationFrame(rafT);
    rafT = requestAnimationFrame(fitDesign);
  });

  /* ===== Strip all @media blocks from every <style> tag =====
     Re-flow media queries would conflict with zoom scaling, so they are
     removed at boot. Inline (author) styles remain untouched. */
  function removeAtMediaBlocks(css) {
    var out = '', i = 0;
    while (i < css.length) {
      var idx = css.indexOf('@media', i);
      if (idx === -1) { out += css.slice(i); break; }
      out += css.slice(i, idx);
      var open = css.indexOf('{', idx);
      if (open === -1) { out += css.slice(idx); break; }
      var depth = 1, j = open + 1;
      while (j < css.length && depth > 0) {
        var c = css.charAt(j);
        if (c === '{') depth++;
        else if (c === '}') depth--;
        j++;
      }
      i = j;
    }
    return out;
  }
  function stripMedia() {
    var ss = document.querySelectorAll('style');
    for (var k = 0; k < ss.length; k++) {
      var css = ss[k].textContent;
      if (css.indexOf('@media') === -1) continue;
      ss[k].textContent = removeAtMediaBlocks(css);
    }
  }
  stripMedia();

  function evalInScope(expr, scope) {
    try {
      var keys = Object.keys(scope);
      var fn = Function.apply(null, keys.concat('return (' + expr + ');'));
      return fn.apply(null, keys.map(function (k) { return scope[k]; }));
    } catch (e) { return undefined; }
  }

  function interpolate(str, scope) {
    return String(str).replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (m, expr) {
      var v = evalInScope(expr, scope);
      if (v === undefined || v === null || typeof v === 'function') return '';
      return String(v);
    });
  }

  function mergeScope(ctx, locals) {
    var s = Object.assign({}, ctx);
    for (var i = 0; i < locals.length; i++) {
      var L = locals[i];
      if (L.listExpr) {
        var list = evalInScope(L.listExpr, ctx);
        s[L.as] = (list && list.length > L.index) ? list[L.index] : undefined;
      } else {
        s[L.as] = L.value;
      }
    }
    return s;
  }

  function expandChildren(srcNode, ctx, locals, registry, signature) {
    var frag = document.createDocumentFragment();
    var children = Array.prototype.slice.call(srcNode.childNodes);
    for (var i = 0; i < children.length; i++) {
      var nodes = expandNode(children[i], ctx, locals, registry, signature);
      for (var j = 0; j < nodes.length; j++) frag.appendChild(nodes[j]);
    }
    return frag;
  }

  function expandNode(node, ctx, locals, registry, signature) {
    if (node.nodeType === 3) {
      var txt = node.nodeValue;
      if (txt.indexOf('{{') === -1) return [document.createTextNode(txt)];
      var span = document.createElement('span');
      var scope = mergeScope(ctx, locals);
      span.textContent = interpolate(txt, scope);
      registry.push({ kind: 'text', node: span, tpl: txt, locals: locals });
      return [span];
    }
    if (node.nodeType !== 1) return [];

    var tag = node.tagName.toLowerCase();

    if (tag === 'sc-if') {
      var scopeIf = mergeScope(ctx, locals);
      var condExpr = (node.getAttribute('value') || 'false').replace(/^\{\{|\}\}$/g, '').trim();
      var cond = !!evalInScope(condExpr, scopeIf);
      signature.push('i' + (cond ? '1' : '0'));
      if (!cond) return [];
      return [expandChildren(node, ctx, locals, registry, signature)];
    }

    if (tag === 'sc-for') {
      var rawList = (node.getAttribute('list') || '[]').replace(/^\{\{|\}\}$/g, '').trim();
      var scopeFor = mergeScope(ctx, locals);
      var list = evalInScope(rawList, scopeFor);
      if (!list || !list.length) list = [];
      var as = node.getAttribute('as') || 'item';
      signature.push('f' + list.length);
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var childLocals = locals.concat([
          { as: as, listExpr: rawList, index: i },
          { as: '$index', value: i }
        ]);
        out.push(expandChildren(node, ctx, childLocals, registry, signature));
      }
      return out;
    }

    var el = document.createElement(tag);
    var attrs = Array.prototype.slice.call(node.attributes);
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name, val = attrs[a].value;
      if (/^(sc-|hint-)/.test(name)) continue;
      var lower = name.toLowerCase();
      if (EVENTS[lower]) {
        (function (eventName, rawExpr, sc) {
          var fn = evalInScope(rawExpr.replace(/^\{\{|\}\}$/g, '').trim(), sc);
          if (typeof fn === 'function') {
            el.addEventListener(eventName, function (ev) { fn(ev); });
          }
        })(EVENTS[lower], val, mergeScope(ctx, locals));
        continue;
      }
      if (val.indexOf('{{') !== -1) {
        el.setAttribute(name, interpolate(val, mergeScope(ctx, locals)));
        registry.push({ kind: 'attr', node: el, name: name, tpl: val, locals: locals });
      } else {
        el.setAttribute(name, val);
      }
    }
    el.appendChild(expandChildren(node, ctx, locals, registry, signature));
    return [el];
  }

  function computeSignature(srcNode, ctx) {
    var sig = [];
    (function walk(n) {
      var kids = n.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c.nodeType !== 1) continue;
        var tag = c.tagName.toLowerCase();
        if (tag === 'sc-if') {
          var condExpr = (c.getAttribute('value') || 'false').replace(/^\{\{|\}\}$/g, '').trim();
          var cond = !!evalInScope(condExpr, ctx);
          sig.push('i' + (cond ? '1' : '0'));
          if (cond) walk(c);
        } else if (tag === 'sc-for') {
          var rawList = (c.getAttribute('list') || '[]').replace(/^\{\{|\}\}$/g, '').trim();
          var list = evalInScope(rawList, ctx) || [];
          sig.push('f' + list.length);
        } else {
          walk(c);
        }
      }
    })(srcNode);
    return sig.join('|');
  }

  function captureForm(root) {
    var fields = root.querySelectorAll('input, textarea, select');
    var data = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      data.push({
        key: f.getAttribute('placeholder') || f.tagName + ':' + i,
        value: f.value, checked: !!f.checked, selectedIndex: f.selectedIndex
      });
    }
    return data;
  }

  function restoreForm(root, data) {
    var map = {};
    for (var i = 0; i < data.length; i++) map[data[i].key] = data[i];
    var fields = root.querySelectorAll('input, textarea, select');
    for (var j = 0; j < fields.length; j++) {
      var f = fields[j];
      var key = f.getAttribute('placeholder') || f.tagName + ':' + j;
      var d = map[key];
      if (!d) continue;
      if (f.type === 'checkbox' || f.type === 'radio') f.checked = d.checked;
      else if (f.tagName.toLowerCase() === 'select') f.selectedIndex = d.selectedIndex;
      else f.value = d.value;
    }
  }

  function initPage(xdc, scriptEl) {
    var code = scriptEl.textContent || '';

    function DCLogic() {}
    DCLogic.prototype.setState = function (patch) {
      var self = this;
      Object.keys(patch || {}).forEach(function (k) { self.state[k] = patch[k]; });
      schedule();
    };
    window.DCLogic = window.DCLogic || DCLogic;

    var Comp;
    try {
      Comp = new Function('DCLogic', code + '\n;return Component;')(window.DCLogic);
    } catch (e) { console.error('[x-dc] class parse failed', e); return; }

    var comp;
    try { comp = new Comp(); }
    catch (e) { console.error('[x-dc] init failed', e); return; }

    /* Keep an untouched template copy */
    var template = document.createElement('div');
    while (xdc.firstChild) template.appendChild(xdc.firstChild);

    /* Hoist <helmet> contents into <head> once */
    var helmet = template.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.childNodes).forEach(function (n) {
        document.head.appendChild(n);
      });
      helmet.parentNode.removeChild(helmet);
    }

    var host = document.createElement('div');
    host.style.display = 'contents';
    xdc.parentNode.insertBefore(host, xdc);
    xdc.parentNode.removeChild(xdc);
    if (scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);

    var registry = [];
    var lastSignature = '';
    var scheduled = false;

    function ctx() {
      try { return comp.renderVals() || {}; }
      catch (e) { console.error('[x-dc] renderVals failed', e); return {}; }
    }

    function fullRebuild(context) {
      var scrollY = window.scrollY;
      var formData = captureForm(host);
      registry = [];
      var signature = [];
      var frag = expandChildren(template, context, [], registry, signature);
      host.textContent = '';
      host.appendChild(frag);
      restoreForm(host, formData);
      window.scrollTo(0, scrollY);
      lastSignature = signature.join('|');
    }

    function softUpdate(context) {
      for (var i = 0; i < registry.length; i++) {
        var rec = registry[i];
        var sc = mergeScope(context, rec.locals);
        if (rec.kind === 'text') rec.node.textContent = interpolate(rec.tpl, sc);
        else rec.node.setAttribute(rec.name, interpolate(rec.tpl, sc));
      }
    }

    function render() {
      var context = ctx();
      var sig = computeSignature(template, context);
      if (sig !== lastSignature) fullRebuild(context);
      else softUpdate(context);
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
        scheduled = false;
        render();
      });
    }

    render();
  }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    try {
      var blocks = document.querySelectorAll('x-dc');
      for (var i = 0; i < blocks.length; i++) {
        var xdc = blocks[i];
        var script = xdc.parentNode.querySelector('script[type="text/x-dc"]');
        if (script) initPage(xdc, script);
      }
      fitDesign();
    } catch (e) {
      console.error('[x-dc] boot failed', e);
    } finally {
      document.body.classList.add('dc-ready');
    }
  });
})();
