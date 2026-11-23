'use strict';

const CATEGORIES = ['price', 'delivery experience', 'app & tech', 'restaurant selection', 'competition', 'customer support', 'other'];
const REQ_TYPES = ['data', 'engineering', 'design', 'ops', 'legal', 'other'];
const EFFORTS = ['S', 'M', 'L'];
const CONFIDENCES = ['low', 'medium', 'high'];

// The experience flywheel: six drivers around the Trigger -> Session -> Order
// cycle, grouped pre-session / in session / post-order (user's exact framework).
const SUBDRIVERS = {
  'Off-platform incentives': ['Marketing', 'Loyalty programs', 'Vouchers'],
  'Supply': ['Quality', 'Variety', 'Exclusivity'],
  'App experience': ['Usability', 'Discoverability', 'Supply information'],
  'Price and discounts': ['Price', 'Fees', 'Discounts'],
  'Delivery': ['Absolute delivery time', 'Pre-purchase ETA', 'Post-purchase ETA and trackability'],
  'Customer & partner service': ['Quality', 'Speed']
};
// Deeper layer under sub-drivers. Only Fees is defined so far; every other
// sub-driver gets two placeholder slots until its splits are decided.
const LEAVES = {
  'Fees': ['Delivery Fee', 'Service Fee', 'Minimum Order Fee']
};

const DRIVERS = [
  { id: 'Off-platform incentives', n: 1, phase: 'Pre-session' },
  { id: 'Supply', n: 2, phase: 'In session' },
  { id: 'App experience', n: 3, phase: 'In session' },
  { id: 'Price and discounts', n: 4, phase: 'In session' },
  { id: 'Delivery', n: 5, phase: 'Post-order' },
  { id: 'Customer & partner service', n: 6, phase: 'Post-order' }
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; } catch (e) { return ''; }
}

function badge(label, cls) { return '<span class="badge ' + cls + '">' + esc(label) + '</span>'; }

function statusBadge(status) {
  const map = {
    accepted: ['Accepted', 'b-green'], submitted: ['In review', 'b-blue'], rejected: ['Rejected', 'b-red'],
    draft: ['Draft', 'b-gray'], merged: ['Merged', 'b-gray']
  };
  const m = map[status] || [status, 'b-gray'];
  return badge(m[0], m[1]);
}

function overlapBadge(verdict) {
  if (!verdict) return '';
  const map = {
    none: ['No overlap', 'b-green'], possible: ['Possible overlap', 'b-amber'],
    strong: ['Strong overlap', 'b-red'], duplicate: ['Duplicate', 'b-red']
  };
  const m = map[verdict] || [verdict, 'b-gray'];
  return badge(m[0], m[1]);
}

function validityChip(v) {
  if (!v || typeof v.score !== 'number') return '';
  const cls = v.score >= 85 ? 'b-green' : v.score >= 55 ? 'b-amber' : 'b-red';
  const word = v.verdict === 'strong' ? 'strong' : v.verdict === 'needs_work' ? 'needs work' : 'weak';
  return badge('Validity ' + v.score + '/100 (' + word + ')', cls);
}

function exampleBadge(isExample) { return isExample ? badge('Example', 'b-example') : ''; }

function roleChip(role) { return badge(role === 'owner' ? 'Owner' : 'Member', role === 'owner' ? 'b-orange' : 'b-gray'); }

function select(name, options, selected) {
  let html = '<select name="' + esc(name) + '">';
  let group = null;
  let open = false;
  for (const o of options) {
    const item = typeof o === 'object' ? o : { value: o, label: o };
    if (item.group && item.group !== group) {
      if (open) html += '</optgroup>';
      html += '<optgroup label="' + esc(item.group) + '">';
      group = item.group;
      open = true;
    } else if (!item.group && open) {
      html += '</optgroup>';
      open = false;
      group = null;
    }
    html += '<option value="' + esc(item.value) + '"' + (String(item.value) === String(selected) ? ' selected' : '') + '>' + esc(item.label) + '</option>';
  }
  if (open) html += '</optgroup>';
  html += '</select>';
  return html;
}

function field(label, name, value, opts) {
  const o = opts || {};
  const req = o.required ? ' required' : '';
  let control;
  if (o.options) {
    control = select(name, o.options, value);
  } else if (o.textarea) {
    control = '<textarea name="' + esc(name) + '" rows="' + (o.rows || 3) + '"' + req + '>' + esc(value) + '</textarea>';
  } else {
    control = '<input type="' + esc(o.type || 'text') + '" name="' + esc(name) + '" value="' + esc(value) + '"' + req +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>';
  }
  return '<div class="f"><label>' + esc(label) + (o.required ? ' <span class="req">*</span>' : '') + '</label>' + control +
    (o.hint ? '<p class="hint">' + esc(o.hint) + '</p>' : '') + '</div>';
}

function checkRows(checks) {
  return (checks || []).map(c =>
    '<tr class="c-' + esc(c.status) + '"><td class="cmark">' + (c.status === 'pass' ? '✓' : c.status === 'warn' ? '~' : '✗') +
    '</td><td class="clabel">' + esc(c.label) + '</td><td class="cmsg">' + esc(c.message) + '</td></tr>').join('');
}

function navLink(href, label, active) {
  return '<a href="' + href + '"' + (active === href ? ' class="on"' : '') + '>' + esc(label) + '</a>';
}

function layout(opts) {
  const o = opts || {};
  const user = o.user;
  const sctx = o.search || {};
  let topsearch = '';
  if (user) {
    topsearch = '<div class="topsearch" id="topSearch"><form method="get" action="/" id="topSearchForm">' +
      (sctx.driver ? '<input type="hidden" name="driver" value="' + esc(sctx.driver) + '"><input type="hidden" name="sub" value="' + esc(sctx.sub || '') + '">' : '') +
      (sctx.sub ? '<input type="hidden" name="type" value="' + esc(sctx.type || '') + '">' : '') +
      '<input type="search" name="q" id="topSearchInput" placeholder="Search pain points\u2026" autocomplete="off" aria-label="Search pain points">' +
      '<button type="button" class="iconbtn" id="topSearchBtn" aria-expanded="false" aria-label="Search">' +
      '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M 12.8 12.8 L 17 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>' +
      '</button></form></div>';
  }
  let userbox = '';
  if (user) {
    const mi = (href, label) =>
      '<a class="mi' + (o.active === href ? ' on' : '') + '" href="' + href + '"><span>' + esc(label) + '</span></a>';
    userbox = '<div class="userbox">' +
      '<button class="userbtn" id="userBtn" type="button" aria-haspopup="true" aria-expanded="false">' +
      (user.name_is_placeholder ? '<span class="namedot" title="Set your display name"></span>' : '') +
      '<span class="uname">' + esc(user.name) + '</span> ' + roleChip(user.role) + '<span class="caret">▾</span></button>' +
      '<div class="usermenu" id="userMenu">' +
      '<a class="mi' + (user.name_is_placeholder ? ' needed' : '') + (o.active === '/profile' ? ' on' : '') + '" href="/profile"><span>Set your name</span></a>' +
      mi('/submit', 'Submit a hypothesis') +
      mi('/mine', 'My submissions') +
      (user.role === 'owner' ? mi('/review', 'Review') + mi('/users', 'People') : '') +
      mi('/help', 'Help') +
      (user.toqan_id ? '' : '<div class="menu-sep"></div><form method="post" action="/logout"><button class="mi asbtn" type="submit"><span>Sign out</span></button></form>') +
      '</div></div>';
  }
  const menuScript = '<script>(function(){var b=document.getElementById("userBtn"),m=document.getElementById("userMenu");if(!b||!m){return;}function c(){m.classList.remove("open");b.setAttribute("aria-expanded","false");}b.addEventListener("click",function(e){e.stopPropagation();var o=m.classList.toggle("open");b.setAttribute("aria-expanded",o?"true":"false");});document.addEventListener("click",c);document.addEventListener("keydown",function(e){if(e.key==="Escape"){c();}});})();</' + 'script>' +
  '<script>(function(){var w=document.getElementById("topSearch"),b=document.getElementById("topSearchBtn"),i=document.getElementById("topSearchInput"),f=document.getElementById("topSearchForm");if(!w||!b||!i||!f){return;}function cs(){w.classList.remove("open");b.setAttribute("aria-expanded","false");}b.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();if(w.classList.contains("open")){if(i.value.trim()){f.submit();}else{cs();}}else{w.classList.add("open");b.setAttribute("aria-expanded","true");setTimeout(function(){i.focus();},60);}});i.addEventListener("keydown",function(e){if(e.key==="Escape"){cs();i.blur();}});document.addEventListener("click",function(e){if(w.classList.contains("open")&&!w.contains(e.target)){cs();}});})();</' + 'script>';
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' +
    esc(o.title ? o.title + ' · Customer Experience Library' : 'Customer Experience Library') +
    '</title>\n<link rel="stylesheet" href="/styles.css">\n</head>\n<body>\n<header class="topbar"><a class="brand homelink" href="/"><span class="brandmark">CX</span><span class="brandname">Customer Experience Library</span></a>' +
    topsearch + userbox + '</header>\n<main class="container">' + (o.content || '') +
    '</main>\n<footer class="footer">Customer Experience Library • 2026</footer>\n' + menuScript + '\n</body>\n</html>';
}

function driverChip(driver) {
  if (!driver) return '';
  const d = DRIVERS.find(x => x.id === driver);
  return '<span class="chip static">' + (d ? d.n + ' \u00b7 ' : '') + esc(driver) + '</span>';
}

// Faithful rebuild of the JET experience flywheel as an inline, server-rendered
// SVG. Core cycle: Trigger -> Session -> Order (clockwise). Six driver pills
// around it, clickable, with accepted-entry counts; active driver highlighted.
function flywheelSvg(active) {
  const cx = 320, cy = 218;
  const fx = n => Math.round(n * 10) / 10;
  const pt = (r, deg) => { const a = deg * Math.PI / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
  const seg = (r1, r2, a0, a1) => {
    const p0 = pt(r2, a0), p1 = pt(r2, a1), p2 = pt(r1, a1), p3 = pt(r1, a0);
    return 'M ' + fx(p0[0]) + ' ' + fx(p0[1]) + ' A ' + r2 + ' ' + r2 + ' 0 0 1 ' + fx(p1[0]) + ' ' + fx(p1[1]) +
      ' L ' + fx(p2[0]) + ' ' + fx(p2[1]) + ' A ' + r1 + ' ' + r1 + ' 0 0 0 ' + fx(p3[0]) + ' ' + fx(p3[1]) + ' Z';
  };
  const arc = (r, a0, a1) => {
    const p0 = pt(r, a0), p1 = pt(r, a1);
    return 'M ' + fx(p0[0]) + ' ' + fx(p0[1]) + ' A ' + r + ' ' + r + ' 0 ' + ((a1 - a0) > 180 ? 1 : 0) + ' 1 ' + fx(p1[0]) + ' ' + fx(p1[1]);
  };
  const PILL = {
    'Off-platform incentives': { x: 6, y: 104, w: 190, h: 32 },
    'Supply': { x: 460, y: 86, w: 110, h: 32 },
    'App experience': { x: 460, y: 146, w: 150, h: 32 },
    'Price and discounts': { x: 460, y: 206, w: 185, h: 32 },
    'Delivery': { x: 6, y: 328, w: 104, h: 32 },
    'Customer & partner service': { x: 6, y: 368, w: 224, h: 32 }
  };
  const CONN = {
    'Off-platform incentives': [[196, 120], [232, 149]],
    'Supply': [[460, 102], [406, 147]],
    'App experience': [[460, 162], [424, 177]],
    'Price and discounts': [[460, 222], [432, 221]],
    'Delivery': [[110, 344], [264, 315]],
    'Customer & partner service': [[218, 384], [300, 328]]
  };
  const segments = [
    { label: 'Session', a0: 0, a1: 120, fill: '#FF8000', text: '#FFFFFF', mid: 60 },
    { label: 'Order', a0: 120, a1: 240, fill: '#F36806', text: '#FFFFFF', mid: 180 },
    { label: 'Trigger', a0: 240, a1: 360, fill: '#FFD9B8', text: '#242E30', mid: 300 }
  ];
  let out = '<svg class="fw" viewBox="0 0 650 415" role="img" aria-label="Customer Experience flywheel: Trigger, Session, Order cycle with six drivers">';
  out += '<defs><marker id="fw-ah" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#242E30"></path></marker></defs>';
  const band = (a0, a1, op) => '<path d="' + arc(146, a0, a1) + '" fill="none" stroke="#C1DADE" stroke-width="20" opacity="' + op + '"></path>';
  const bx = v => Math.round(v * 1000) / 1000;
  for (let i = 0; i < 6; i++) out += band(i * 5 - 15, i * 5 - 10, bx(0.5 * (i + 0.5) / 6));
  out += band(15, 225, 0.5);
  for (let i = 0; i < 6; i++) out += band(225 + i * 5, 230 + i * 5, bx(0.5 * (6 - i - 0.5) / 6));
  for (const g of segments) {
    out += '<path d="' + seg(50, 116, g.a0, g.a1) + '" fill="' + g.fill + '" stroke="#FFFFFF" stroke-width="5"></path>';
    const l = pt(83, g.mid);
    out += '<text x="' + fx(l[0]) + '" y="' + fx(l[1]) + '" text-anchor="middle" dy=".35em" font-size="13" font-weight="800" fill="' + g.text + '">' + g.label + '</text>';
  }
  for (const m of [60, 180, 300]) {
    out += '<path d="' + arc(127, m - 44, m + 44) + '" fill="none" stroke="#242E30" stroke-width="2.5" marker-end="url(#fw-ah)"></path>';
  }
  out += '<circle cx="' + cx + '" cy="' + cy + '" r="31" fill="#FFFFFF" stroke="#E6E2DC"></circle>';
  out += '<image href="/flywheel-logo.png" x="298.7" y="196" width="42.6" height="44" preserveAspectRatio="xMidYMid meet"></image>';
  out += '<text x="6" y="92" font-size="10" font-weight="800" letter-spacing="1.2" fill="#5B6B6E">PRE-SESSION</text>';
  out += '<text x="460" y="74" font-size="10" font-weight="800" letter-spacing="1.2" fill="#5B6B6E">IN SESSION</text>';
  out += '<text x="6" y="318" font-size="10" font-weight="800" letter-spacing="1.2" fill="#5B6B6E">POST-ORDER</text>';
  for (const d of DRIVERS) {
    const c = CONN[d.id];
    out += '<line x1="' + c[0][0] + '" y1="' + c[0][1] + '" x2="' + c[1][0] + '" y2="' + c[1][1] + '" stroke="#5B6B6E" stroke-width="1.5" stroke-dasharray="2 4" opacity="0.8"></line>';
  }
  for (const d of DRIVERS) {
    const g = PILL[d.id];
    const on = active === d.id;

    out += '<a href="/?driver=' + encodeURIComponent(d.id) + '" class="fw-pill' + (on ? ' on' : '') + '">';
    out += '<rect x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" rx="16" fill="' + (on ? '#FF8000' : '#ECEEEF') + '" stroke="' + (on ? '#F36806' : '#E6E2DC') + '"></rect>';
    out += '<circle cx="' + (g.x + 17) + '" cy="' + (g.y + 16) + '" r="10" fill="#FFFFFF"></circle>';
    out += '<text x="' + (g.x + 17) + '" y="' + (g.y + 16) + '" text-anchor="middle" dy=".35em" font-size="11" font-weight="800" fill="' + (on ? '#FF8000' : '#242E30') + '">' + d.n + '</text>';
    out += '<text x="' + (g.x + 33) + '" y="' + (g.y + 16) + '" dy=".35em" font-size="11.5" font-weight="700" fill="' + (on ? '#FFFFFF' : '#242E30') + '">' + esc(d.id) + '</text>';
    out += '</a>';
  }
  out += '</svg>';
  return out;
}

module.exports = {
  esc, fmtDate, badge, statusBadge, overlapBadge, validityChip, exampleBadge, roleChip,
  select, field, checkRows, layout, navLink,
  CATEGORIES, REQ_TYPES, EFFORTS, CONFIDENCES,
  DRIVERS, SUBDRIVERS, LEAVES, driverChip, flywheelSvg
};
