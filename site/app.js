const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const DAY = 86400000;
const KST = 9 * 3600000;
const PRIVATE = "(private)";
const numberFull = new Intl.NumberFormat("en");
const numberShort = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n) => numberFull.format(Math.round(n));
const short = (n) => (Math.abs(n) < 1000 ? numberFull.format(Math.round(n)) : numberShort.format(n));
const monthDay = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("en", {
  weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
};

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k === "style") node.style.cssText = v;
    else if (k in node && k !== "list") node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

// dates are "YYYY-MM-DD" strings handled as UTC midnights
const toTime = (d) => Date.parse(`${d}T00:00:00Z`);
const toDay = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => toDay(toTime(d) + n * DAY);
const weekStart = (d) => addDays(d, -((new Date(toTime(d)).getUTCDay() + 6) % 7));
const kstToday = () => toDay(Date.now() + KST);

// a top value whose quarter is a round number, so all four gridlines get clean labels
function niceMax(max, ticks = 4) {
  if (max <= 0) return ticks;
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= raw) * pow;
  return Math.max(step, 1) * ticks;
}

function quantileLevels(values) {
  const nonzero = values.filter((v) => v > 0).sort((a, b) => a - b);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => nonzero[Math.floor(q * (nonzero.length - 1))] ?? 0);
  return (v) => (v <= 0 ? 0 : 1 + cuts.filter((c) => v > c).length);
}

/* tooltip */
const tip = $("tip");
function showTip(x, y, title, rows) {
  tip.replaceChildren(h("div", { className: "t", text: title }));
  for (const row of rows) {
    const line = h("div", { className: "r" });
    if (row.color) line.append(h("i", { style: `background:${row.color}` }));
    line.append(h("b", { text: row.value }), h("span", { text: row.label ?? "" }));
    tip.append(line);
  }
  tip.style.display = "block";
  const { width, height } = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + width > innerWidth - 8) left = x - width - 14;
  if (top + height > innerHeight - 8) top = y - height - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
const hideTip = () => { tip.style.display = "none"; };

function hover(node, content) {
  node.setAttribute("tabindex", "0");
  const show = (x, y) => { const [t, rows] = content(); showTip(x, y, t, rows); };
  node.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
  node.addEventListener("pointerleave", hideTip);
  node.addEventListener("focus", () => { const r = node.getBoundingClientRect(); show(r.right, r.top); });
  node.addEventListener("blur", hideTip);
}

function legend(items) {
  return h("div", { className: "legend" }, ...items.map(({ name, color, line }) =>
    h("span", {}, h("i", { className: line ? "line" : "", style: `background:${color}` }), name)));
}

function dataTable(head, rows) {
  const table = h("table", {},
    h("thead", {}, h("tr", {}, ...head.map((c, i) => h("th", { className: i ? "num" : "", text: c })))),
    h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c, i) =>
      h("td", { className: i ? "num" : "", text: typeof c === "number" ? fmt(c) : c }))))));
  return h("details", { className: "data" }, h("summary", { text: "Data" }), h("div", { className: "scroll" }, table));
}

function empty(container, text) {
  container.replaceChildren(h("div", { className: "empty", text }));
}

function axisLabel(d, span) {
  return span > 400 ? monthYear.format(toTime(d)) : monthDay.format(toTime(d));
}

function frame(container, height, left = 40) {
  const width = Math.max(container.clientWidth, 240);
  const m = { top: 10, right: 12, bottom: 22, left };
  const root = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img" });
  return { root, width, height, m, w: width - m.left - m.right, ih: height - m.top - m.bottom };
}

function yAxis(f, max, ticks = 4) {
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = f.m.top + f.ih - (v / max) * f.ih;
    svg("line", { x1: f.m.left, x2: f.m.left + f.w, y1: y, y2: y, class: i ? "grid-line" : "base-line" }, f.root);
    svg("text", { x: f.m.left - 6, y: y + 4, "text-anchor": "end" }, f.root).textContent = short(v);
  }
}

function xLabels(f, labels, xAt) {
  const span = labels.length > 1 ? (toTime(labels.at(-1)) - toTime(labels[0])) / DAY : 0;
  const count = Math.max(2, Math.min(6, Math.floor(f.w / 90)));
  const step = Math.max(1, Math.ceil((labels.length - 1) / (count - 1)));
  for (let i = 0; i < labels.length; i += step) {
    const anchor = i === 0 ? "start" : "middle";
    svg("text", { x: xAt(i), y: f.height - 6, "text-anchor": anchor }, f.root).textContent =
      /^\d{4}-\d{2}-\d{2}$/.test(labels[i]) ? axisLabel(labels[i], span) : labels[i];
  }
}

function lineChart(container, { labels, series, height = 200, title = (l) => l }) {
  container.replaceChildren();
  if (!labels.length) return empty(container, "No data in this range yet");
  const f = frame(container, height);
  if (series.length <= 2) f.m.right = 44, f.w = f.width - f.m.left - f.m.right;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values)));
  const xAt = (i) => f.m.left + (labels.length === 1 ? f.w / 2 : (i / (labels.length - 1)) * f.w);
  const yAt = (v) => f.m.top + f.ih - (v / max) * f.ih;
  yAxis(f, max);
  xLabels(f, labels, xAt);
  series.forEach((s, k) => {
    const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    if (series.length === 1 && labels.length > 1) {
      svg("path", {
        d: `M${xAt(0)},${yAt(0)}L${pts.join("L")}L${xAt(labels.length - 1)},${yAt(0)}Z`,
        style: `fill:${s.color};opacity:.1`,
      }, f.root);
    }
    if (labels.length > 1) {
      svg("path", {
        d: `M${pts.join("L")}`, fill: "none", "stroke-width": 2, "stroke-linejoin": "round",
        "stroke-linecap": "round", style: `stroke:${s.color}`,
      }, f.root);
    }
    const last = s.values.at(-1);
    svg("circle", {
      cx: xAt(labels.length - 1), cy: yAt(last), r: 4, "stroke-width": 2,
      style: `fill:${s.color};stroke:var(--surface)`,
    }, f.root);
    if (series.length <= 2) {
      const dy = series.length === 2 && k === 1 && Math.abs(yAt(last) - yAt(series[0].values.at(-1))) < 12 ? 12 : 0;
      svg("text", { x: xAt(labels.length - 1) + 8, y: yAt(last) + 4 + dy, class: "end-label" }, f.root)
        .textContent = short(last);
    }
  });
  const cross = svg("line", { y1: f.m.top, y2: f.m.top + f.ih, class: "cross", visibility: "hidden" }, f.root);
  const dots = series.map((s) => svg("circle", {
    r: 4, "stroke-width": 2, visibility: "hidden", style: `fill:${s.color};stroke:var(--surface)`,
  }, f.root));
  const hit = svg("rect", { x: f.m.left - 6, y: 0, width: f.w + 12, height: f.height, class: "hit" }, f.root);
  hit.addEventListener("pointermove", (e) => {
    const box = f.root.getBoundingClientRect();
    const x = e.clientX - box.left;
    const i = labels.length === 1 ? 0
      : Math.max(0, Math.min(labels.length - 1, Math.round(((x - f.m.left) / f.w) * (labels.length - 1))));
    cross.setAttribute("x1", xAt(i));
    cross.setAttribute("x2", xAt(i));
    cross.setAttribute("visibility", "visible");
    series.forEach((s, k) => {
      dots[k].setAttribute("cx", xAt(i));
      dots[k].setAttribute("cy", yAt(s.values[i]));
      dots[k].setAttribute("visibility", "visible");
    });
    showTip(e.clientX, e.clientY, title(labels[i]),
      series.map((s) => ({ color: s.color, value: fmt(s.values[i]), label: s.name })));
  });
  hit.addEventListener("pointerleave", () => {
    hideTip();
    cross.setAttribute("visibility", "hidden");
    for (const d of dots) d.setAttribute("visibility", "hidden");
  });
  container.append(f.root);
  if (series.length > 1) container.append(legend(series.map((s) => ({ ...s, line: true }))));
  container.append(dataTable(["Date", ...series.map((s) => s.name)],
    labels.map((l, i) => [l, ...series.map((s) => s.values[i])]).reverse()));
}

function barPath(x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

function columnChart(container, { labels, stacks, height = 200, title = (l) => l, unit = "" }) {
  container.replaceChildren();
  if (!labels.length) return empty(container, "No data in this range yet");
  const f = frame(container, height);
  const totals = labels.map((_, i) => stacks.reduce((a, s) => a + s.values[i], 0));
  const max = niceMax(Math.max(...totals));
  const band = f.w / labels.length;
  const gap = band >= 4 ? 2 : 0;
  const bw = Math.max(1, Math.min(24, band - gap));
  const yAt = (v) => f.m.top + f.ih - (v / max) * f.ih;
  const xAt = (i) => f.m.left + band * i + band / 2;
  yAxis(f, max);
  xLabels(f, labels, xAt);
  labels.forEach((label, i) => {
    const x = xAt(i) - bw / 2;
    const parts = stacks.map((s) => [s, s.values[i]]).filter(([, v]) => v > 0);
    let base = 0;
    parts.forEach(([s, v], k) => {
      const y1 = yAt(base + v);
      const y0 = yAt(base);
      const top = k === parts.length - 1;
      const hgt = Math.max(top ? 1 : 0, y0 - y1 - (k && gap ? gap : 0));
      if (hgt > 0) {
        svg("path", {
          d: top ? barPath(x, y1, bw, hgt, 4) : `M${x},${y1}h${bw}v${hgt}h${-bw}Z`,
          class: "mark", style: `fill:${s.color}`,
        }, f.root);
      }
      base += v;
    });
    const hit = svg("rect", { x: xAt(i) - band / 2, y: f.m.top, width: band, height: f.ih, class: "hit" }, f.root);
    hover(hit, () => [title(label), [
      ...(stacks.length > 1 ? [{ value: fmt(totals[i]), label: `total${unit}` }] : []),
      ...stacks.map((s) => ({ color: s.color, value: fmt(s.values[i]), label: stacks.length > 1 ? s.name : `${s.name}${unit}` })),
    ]]);
  });
  container.append(f.root);
  if (stacks.length > 1) container.append(legend(stacks));
  container.append(dataTable(["Period", ...stacks.map((s) => s.name)],
    labels.map((l, i) => [l, ...stacks.map((s) => s.values[i])]).reverse()));
}

function barList(container, items, { limit = 12, format = fmt } = {}) {
  container.replaceChildren();
  if (!items.length) return empty(container, "Nothing to show yet");
  const shown = items.slice(0, limit);
  const rest = items.slice(limit);
  if (rest.length) shown.push({ label: `${rest.length} more`, value: rest.reduce((a, b) => a + b.value, 0), other: true });
  const max = Math.max(...shown.map((i) => i.value)) || 1;
  const grid = h("div", { className: "bars" });
  for (const item of shown) {
    const name = item.href
      ? h("a", { className: "name", href: item.href, text: item.label, title: item.label })
      : h("span", { className: "name", text: item.label, title: item.label });
    const bar = h("span", { className: "bar", style: `width:calc((100% - 90px) * ${item.value / max})${item.other ? ";background:var(--other)" : ""}` });
    grid.append(name, h("span", { className: "track" }, bar, h("span", { className: "val", text: item.text ?? format(item.value) })));
  }
  container.append(grid);
}

const LEVELS = ["var(--q0)", "var(--q1)", "var(--q2)", "var(--q3)", "var(--q4)", "var(--q5)"];

function calendar(container, days, end) {
  container.replaceChildren();
  const first = addDays(weekStart(end), -52 * 7);
  const values = [];
  for (let d = first; d <= end; d = addDays(d, 1)) values.push([d, days[d] ?? 0]);
  const level = quantileLevels(values.map(([, v]) => v));
  const weeks = 53;
  const cell = Math.max(9, Math.min(16, Math.floor((container.clientWidth - 30) / weeks) - 2));
  const pitch = cell + 2;
  const width = 30 + weeks * pitch;
  const height = 18 + 7 * pitch;
  const root = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img" });
  ["Mon", "", "Wed", "", "Fri", "", ""].forEach((name, r) => {
    if (name) svg("text", { x: 0, y: 18 + r * pitch + cell - 1 }, root).textContent = name;
  });
  let lastMonth = "";
  values.forEach(([d, v], i) => {
    const col = Math.floor(i / 7);
    const row = i % 7;
    const month = d.slice(0, 7);
    if (row === 0 && month !== lastMonth) {
      if (col < weeks - 2) svg("text", { x: 30 + col * pitch, y: 10 }, root).textContent = monthYear.format(toTime(d)).split(" ")[0];
      lastMonth = month;
    }
    const rect = svg("rect", {
      x: 30 + col * pitch, y: 18 + row * pitch, width: cell, height: cell, rx: 2,
      class: "mark", style: `fill:${LEVELS[level(v)]}`,
    }, root);
    hover(rect, () => [longDate.format(toTime(d)), [{ value: fmt(v), label: v === 1 ? "contribution" : "contributions" }]]);
  });
  const wrap = h("div", { style: "overflow-x:auto" }, root);
  container.append(wrap, h("div", { className: "cal-legend" }, "Less",
    ...LEVELS.map((c) => h("i", { style: `background:${c}` })), "More"));
  wrap.scrollLeft = wrap.scrollWidth;
  const total = values.reduce((a, [, v]) => a + v, 0);
  const active = values.filter(([, v]) => v > 0).length;
  // today may simply not have a contribution yet, so the streak can end yesterday
  let streak = 0;
  for (let i = values.length - (values.at(-1)[1] ? 1 : 2); i >= 0 && values[i][1] > 0; i--) streak++;
  let best = 0;
  let run = 0;
  for (const [, v] of values) { run = v > 0 ? run + 1 : 0; best = Math.max(best, run); }
  $("cal-cap").textContent = `${fmt(total)} contributions in the last 12 months · active on ${active} days · current streak ${streak} days · longest ${best} days`;
}

function punchCard(container, punch) {
  container.replaceChildren();
  if (!Math.max(...punch.flat())) return empty(container, "No commits yet");
  const level = quantileLevels(punch.flat());
  const width = Math.max(container.clientWidth, 280);
  const left = 34;
  const pitch = (width - left) / 24;
  const cellW = Math.max(4, pitch - 2);
  const cellH = 18;
  const height = 20 + 7 * (cellH + 2);
  const root = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img" });
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  names.forEach((n, r) => { svg("text", { x: 0, y: r * (cellH + 2) + 13 }, root).textContent = n; });
  for (let hr = 0; hr < 24; hr += 3) {
    svg("text", { x: left + hr * pitch, y: height - 4 }, root).textContent = `${hr}h`;
  }
  punch.forEach((row, r) => row.forEach((v, hr) => {
    const rect = svg("rect", {
      x: left + hr * pitch, y: r * (cellH + 2), width: cellW, height: cellH, rx: 2,
      class: "mark", style: `fill:${LEVELS[level(v)]}`,
    }, root);
    hover(rect, () => [`${names[r]} ${String(hr).padStart(2, "0")}:00–${String(hr + 1).padStart(2, "0")}:00`, [{ value: fmt(v), label: "commits" }]]);
  }));
  container.append(root);
  const byHour = Array.from({ length: 24 }, (_, hr) => punch.reduce((a, row) => a + row[hr], 0));
  const byDay = punch.map((row) => row.reduce((a, b) => a + b, 0));
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const peakDay = byDay.indexOf(Math.max(...byDay));
  const night = byHour.slice(0, 6).reduce((a, b) => a + b, 0) / byHour.reduce((a, b) => a + b, 0);
  container.append(h("p", { className: "cap", style: "margin-top:8px", text:
    `Busiest hour ${peakHour}:00 · busiest day ${names[peakDay]} · ${Math.round(night * 100)}% of commits between midnight and 6:00` }));
}

/* bucketing for the range filter */
function bucketBy(days) {
  if (days && days <= 120) return { key: (d) => d, label: "day" };
  if (days && days <= 730) return { key: weekStart, label: "week" };
  return { key: (d) => `${d.slice(0, 7)}-01`, label: "month" };
}

function seriesFromDays(map, start, end, valueOf, bucket) {
  const buckets = new Map();
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const k = bucket.key(d);
    buckets.set(k, (buckets.get(k) ?? 0) + valueOf(map[d], d));
  }
  return [[...buckets.keys()], [...buckets.values()]];
}

function periodTitle(bucket) {
  return (d) => bucket.label === "day" ? longDate.format(toTime(d))
    : bucket.label === "week" ? `Week of ${monthDay.format(toTime(d))}, ${d.slice(0, 4)}`
    : monthYear.format(toTime(d));
}

/* page */
let data;
let rangeDays = Number(store.get("range") ?? 90);
let repoSort = { key: "pushed", dir: -1 };

async function load() {
  const names = ["latest", "history", "traffic", "actions"];
  const files = await Promise.all(names.map((n) =>
    fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null))));
  return Object.fromEntries(names.map((n, i) => [n, files[i]]));
}

function rangeStart(end, earliest) {
  return rangeDays ? addDays(end, -(rangeDays - 1)) : earliest;
}

function header() {
  const s = data.latest;
  const p = s.profile;
  $("title").textContent = `${p.name ?? p.login} on GitHub`;
  const av = $("avatar");
  av.src = p.avatar;
  av.hidden = false;
  const updated = new Date(s.generated);
  const stamp = new Intl.DateTimeFormat("en", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul",
  }).format(updated);
  $("meta").replaceChildren(
    h("a", { href: `https://github.com/${p.login}`, text: `@${p.login}` }),
    ` · updated ${stamp} KST · on GitHub since ${p.created.slice(0, 4)}`,
  );
  const notes = $("notes");
  notes.replaceChildren();
  const stale = ["private", "contributions", "commits", "pulls"].filter((k) => s[k]?.updated && s[k].updated < s.generated);
  if (s.scope !== "full") {
    notes.append(h("div", { className: "note", text:
      `The last run had no owner token, so private repositories and traffic were not refreshed${stale.length ? ` (kept from ${s[stale[0]].updated.slice(0, 10)})` : ""}. Add the STATS_TOKEN secret to fix this.` }));
  }
}

function historyDelta(key, value) {
  const rows = data.history ?? [];
  const target = addDays(rows.at(-1)?.date ?? kstToday(), -7);
  const past = rows.filter((r) => r.date <= target).at(-1);
  if (!past || past[key] == null) return null;
  return value - past[key];
}

function ciTotals(start) {
  const totals = { runs: 0, ok: 0, failed: 0, seconds: 0 };
  for (const [d, repos] of Object.entries(data.actions?.days ?? {})) {
    if (d < start) continue;
    for (const c of Object.values(repos)) {
      for (const [k, v] of Object.entries(c)) {
        if (k === "seconds") { totals.seconds += v; continue; }
        totals.runs += v;
        if (k === "success") totals.ok += v;
        if (["failure", "timed_out", "startup_failure"].includes(k)) totals.failed += v;
      }
    }
  }
  return totals;
}

function tile(label, value, sub, deltaKey) {
  const node = h("div", { className: "tile" }, h("div", { className: "label", text: label }),
    h("div", { className: "value", text: typeof value === "number" ? fmt(value) : value }));
  const delta = deltaKey ? historyDelta(deltaKey, value) : null;
  const subLine = h("div", { className: "sub" });
  if (delta) {
    subLine.append(h("span", { className: `delta ${delta > 0 ? "up" : "down"}`, text: `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))}` }), " vs 7 days ago");
    if (sub) subLine.append(h("br"));
  }
  if (sub) subLine.append(sub);
  node.append(subLine);
  return node;
}

function tiles() {
  const s = data.latest;
  const t = s.totals;
  const ly = s.contributions.last_year;
  const ci = ciTotals(addDays(kstToday(), -29));
  const finished = ci.ok + ci.failed;
  $("tiles").replaceChildren(
    tile("Contributions, 12 months", t.contributions_year, `${fmt(ly.commits)} commits · ${fmt(ly.pulls)} PRs · ${fmt(ly.issues)} issues`, "contributions_year"),
    tile("Commits, 12 months", t.commits_year, `+${short(s.commits.additions)} / −${short(s.commits.deletions)} lines`, "commits_year"),
    tile("Stars", t.stars, `${fmt(t.forks)} forks`, "stars"),
    tile("Followers", t.followers, `following ${fmt(s.profile.following)}`, "followers"),
    tile("Repositories", t.repos_public + t.repos_private, `${t.repos_public} public · ${t.repos_private} private`),
    tile("Merged pull requests", t.pulls_merged, `${t.pulls_upstream_merged} upstream`, "pulls_merged"),
    tile("Views, 14 days", t.views_14, `${fmt(t.clones_14)} clones`, "views_14"),
    tile("CI success, 30 days", finished ? `${Math.round((ci.ok / finished) * 100)}%` : "–",
      `${fmt(ci.runs)} runs · ${fmt(ci.seconds / 60)} min`),
  );
}

function activity(end) {
  const s = data.latest;
  const days = s.contributions.days;
  const earliest = Object.keys(days)[0] ?? end;
  const start = rangeStart(end, earliest);
  const bucket = bucketBy(rangeDays);
  const [labels, values] = seriesFromDays(days, start < earliest ? earliest : start, end, (v) => v ?? 0, bucket);
  $("contrib-cap").textContent = `Per ${bucket.label} · ${fmt(values.reduce((a, b) => a + b, 0))} in range`;
  columnChart($("contrib-time"), {
    labels, stacks: [{ name: "Contributions", color: "var(--s1)", values }], title: periodTitle(bucket),
  });
  const weekly = s.commits.weekly.filter((w) => w.week >= weekStart(start));
  const weekTitle = periodTitle({ label: "week" });
  columnChart($("lines-add"), {
    labels: weekly.map((w) => w.week), title: weekTitle,
    stacks: [{ name: "Lines added", color: "var(--s3)", values: weekly.map((w) => w.additions) }],
  });
  columnChart($("lines-del"), {
    labels: weekly.map((w) => w.week), title: weekTitle,
    stacks: [{ name: "Lines deleted", color: "var(--s2)", values: weekly.map((w) => w.deletions) }],
  });
}

function staticActivity() {
  const s = data.latest;
  punchCard($("punch"), s.commits.punch);
  const years = Object.entries(s.contributions.years);
  const pick = (k) => years.map(([, y]) => y[k]);
  columnChart($("years"), {
    labels: years.map(([y]) => y),
    stacks: [
      { name: "Commits", color: "var(--s1)", values: pick("commits") },
      { name: "Pull requests", color: "var(--s2)", values: pick("pulls") },
      { name: "Issues", color: "var(--s3)", values: pick("issues") },
      { name: "Reviews and new repos", color: "var(--s4)", values: years.map(([, y]) => y.reviews + y.repos) },
      { name: "Private", color: "var(--other)", values: pick("restricted") },
    ],
  });
}

const REPO_COLUMNS = [
  { key: "name", label: "Repository" },
  { key: "language", label: "Language" },
  { key: "stars", label: "Stars", num: true },
  { key: "forks", label: "Forks", num: true },
  { key: "issues_open", label: "Issues", num: true },
  { key: "pulls_open", label: "PRs", num: true },
  { key: "commits_year", label: "Commits 1y", num: true },
  { key: "commits", label: "Commits", num: true },
  { key: "views", label: "Views 14d", num: true, get: (r) => r.traffic.views },
  { key: "clones", label: "Clones 14d", num: true, get: (r) => r.traffic.clones },
  { key: "ci", label: "CI 30d", num: true, get: (r) => r.ci.runs },
  { key: "releases", label: "Releases", num: true },
  { key: "pushed", label: "Last push" },
];

function relative(iso) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / DAY);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return monthYear.format(Date.parse(iso));
}

function ciCell(ci) {
  if (!ci.runs) return h("span", { className: "status muted", text: "none" });
  const cls = ci.last === "success" ? "good" : ["failure", "timed_out", "startup_failure"].includes(ci.last) ? "critical" : "warning";
  return h("span", { className: `status ${cls}`, title: `last run: ${ci.last}`, text: `${ci.runs}${ci.failed ? ` · ${ci.failed} failed` : ""}` });
}

function repoTable() {
  const s = data.latest;
  const query = $("repo-filter").value.trim().toLowerCase();
  const archived = $("show-archived").checked;
  const col = REPO_COLUMNS.find((c) => c.key === repoSort.key);
  const value = (r) => (col.get ? col.get(r) : r[col.key]) ?? (col.num ? -1 : "");
  const rows = s.repos
    .filter((r) => archived || !r.archived)
    .filter((r) => !query || `${r.name} ${r.description ?? ""} ${r.language ?? ""} ${r.topics.join(" ")}`.toLowerCase().includes(query))
    .sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * repoSort.dir;
    });
  const head = h("tr", {}, ...REPO_COLUMNS.map((c) => {
    const th = h("th", { className: c.num ? "num" : "", text: c.label });
    th.dataset.key = c.key;
    if (c.key === repoSort.key) th.setAttribute("aria-sort", repoSort.dir > 0 ? "ascending" : "descending");
    th.addEventListener("click", () => {
      repoSort = { key: c.key, dir: repoSort.key === c.key ? -repoSort.dir : c.num || c.key === "pushed" ? -1 : 1 };
      repoTable();
    });
    return th;
  }));
  const body = h("tbody");
  for (const r of rows) {
    body.append(h("tr", {},
      h("td", {}, h("a", { href: r.url, text: r.name }), r.archived ? h("span", { style: "color:var(--muted)", text: " archived" }) : null,
        r.description ? h("span", { className: "desc", text: r.description, title: r.description }) : null),
      h("td", {}, r.language ? h("span", { className: "dot", style: `background:${r.color ?? "var(--other)"}` }) : null, r.language ?? "–"),
      ...["stars", "forks", "issues_open", "pulls_open", "commits_year", "commits"].map((k) => h("td", { className: "num", text: fmt(r[k]) })),
      h("td", { className: "num", text: fmt(r.traffic.views) }),
      h("td", { className: "num", text: fmt(r.traffic.clones) }),
      h("td", { className: "num" }, ciCell(r.ci)),
      h("td", { className: "num", text: r.latest_release ? r.latest_release.tagName : fmt(r.releases) }),
      h("td", { text: r.pushed ? relative(r.pushed) : "–", title: r.pushed ?? "" }),
    ));
  }
  const p = s.private;
  if (p?.count) {
    body.append(h("tr", { className: "agg" },
      h("td", { text: `${p.count} private repositories` }), h("td", { text: "" }),
      h("td", { className: "num", text: fmt(p.stars) }), h("td", { className: "num", text: "–" }),
      h("td", { className: "num", text: fmt(p.issues_open) }), h("td", { className: "num", text: fmt(p.pulls_open) }),
      h("td", { className: "num", text: fmt(p.commits_year) }), h("td", { className: "num", text: fmt(p.commits) }),
      h("td", { className: "num", text: fmt(p.traffic.views) }), h("td", { className: "num", text: fmt(p.traffic.clones) }),
      h("td", { className: "num" }, ciCell(p.ci)), h("td", { className: "num", text: "–" }), h("td", { text: "" })));
  }
  $("repo-table").replaceChildren(h("thead", {}, head), body);
  $("repo-count").textContent = `${rows.length} of ${s.repos.length} public`;
}

function repoLists() {
  const s = data.latest;
  barList($("by-repo"), s.contributions.by_repo.map((r) => ({
    label: r.repo, value: r.commits,
    href: r.repo === PRIVATE ? undefined : `https://github.com/${r.repo.includes("/") ? r.repo : `${s.profile.login}/${r.repo}`}`,
  })));
  const langs = Object.entries(s.languages.items);
  const total = langs.reduce((a, [, l]) => a + l.bytes, 0) || 1;
  barList($("languages"), langs.map(([name, l]) => ({
    label: name, value: l.bytes, text: `${((l.bytes / total) * 100).toFixed(1)}% · ${l.repos} repos`,
  })), { limit: 10, format: (v) => `${((v / total) * 100).toFixed(1)}%` });
}

function pullTiles() {
  const s = data.latest;
  const c = s.pulls.counts;
  const own = c.own ?? {};
  const up = c.elsewhere ?? {};
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const ic = s.issues.counts.own ?? {};
  const rec = s.pulls.received;
  const irec = s.issues.received;
  $("pull-tiles").replaceChildren(
    tile("PRs to my repositories", sum(own), `${fmt(own.merged ?? 0)} merged · ${fmt(own.open ?? 0)} open`),
    tile("Upstream PRs", sum(up), `${fmt(up.merged ?? 0)} merged · ${fmt(up.open ?? 0)} open · ${fmt(up.closed ?? 0)} closed`),
    tile("Upstream merge rate", sum(up) - (up.open ?? 0) ? `${Math.round(((up.merged ?? 0) / (sum(up) - (up.open ?? 0))) * 100)}%` : "–", "of decided PRs"),
    tile("Issues I opened", sum(ic), `${fmt(ic.open ?? 0)} open · ${fmt(ic.closed ?? 0)} closed`),
    tile("PRs from others", rec.open + rec.merged + rec.closed, `${fmt(rec.merged)} merged · ${fmt(rec.open)} open`),
    tile("Issues from others", irec.open + irec.closed, `${fmt(irec.open)} open`),
  );
  const table = $("upstream");
  const rows = s.pulls.elsewhere;
  if (!rows.length) { table.replaceChildren(); return; }
  const cls = { merged: "good", open: "warning", closed: "muted" };
  table.replaceChildren(
    h("thead", {}, h("tr", {}, ...["Repository", "Pull request", "State", "Opened", "Changes"].map((t, i) =>
      h("th", { className: i === 4 ? "num" : "", text: t })))),
    h("tbody", {}, ...rows.map((pr) => h("tr", {},
      h("td", { text: pr.repo }),
      h("td", { style: "white-space:normal;min-width:260px" }, h("a", { href: pr.url, text: pr.title })),
      h("td", {}, h("span", { className: `status ${cls[pr.state] ?? "muted"}`, text: pr.state })),
      h("td", { text: pr.created.slice(0, 10) }),
      h("td", { className: "num", text: pr.additions == null ? "–" : `+${fmt(pr.additions)} −${fmt(pr.deletions)}` }))),
    ));
}

function monthly(container, months, start) {
  const from = start.slice(0, 7);
  const keys = Object.keys(months);
  if (!keys.length) return empty(container, "None yet");
  const labels = [];
  for (let m = keys[0] > from ? keys[0] : from; m <= kstToday().slice(0, 7);) {
    labels.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  columnChart(container, {
    labels: labels.map((m) => `${m}-01`),
    title: (d) => monthYear.format(toTime(d)),
    stacks: [
      { name: "My repositories", color: "var(--s1)", values: labels.map((m) => months[m]?.own ?? 0) },
      { name: "Elsewhere", color: "var(--s2)", values: labels.map((m) => months[m]?.elsewhere ?? 0) },
    ],
  });
}

function trafficCharts(end) {
  const repos = data.traffic?.repos ?? {};
  const daily = { views: {}, clones: {} };
  for (const entry of Object.values(repos)) {
    for (const kind of ["views", "clones"]) {
      for (const [d, [n, u]] of Object.entries(entry[kind])) {
        const cur = daily[kind][d] ?? [0, 0];
        daily[kind][d] = [cur[0] + n, cur[1] + u];
      }
    }
  }
  const draw = (kind, container, names) => {
    const known = Object.keys(daily[kind]).sort();
    if (!known.length) return empty(container, "No traffic data yet");
    const start = rangeStart(end, known[0]);
    const from = start < known[0] ? known[0] : start;
    const last = known.at(-1);
    const labels = [];
    for (let d = from; d <= last; d = addDays(d, 1)) labels.push(d);
    lineChart(container, {
      labels, title: (d) => longDate.format(toTime(d)),
      series: names.map((name, k) => ({
        name, color: `var(--s${k + 1})`, values: labels.map((d) => daily[kind][d]?.[k] ?? 0),
      })),
    });
  };
  draw("views", $("views"), ["Views", "Unique visitors"]);
  draw("clones", $("clones"), ["Clones", "Unique cloners"]);

  const start = rangeStart(end, "0000-00-00");
  const login = data.latest.profile.login;
  const top = Object.entries(repos)
    .map(([name, e]) => ({
      label: name, href: name === PRIVATE ? undefined : `https://github.com/${login}/${name}`,
      value: Object.entries(e.views).filter(([d]) => d >= start).reduce((a, [, [n]]) => a + n, 0),
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  $("top-views-cap").textContent = rangeDays ? `Page views in the last ${rangeDays} days` : "Page views since tracking began";
  barList($("top-views"), top, { limit: 10 });

  const refs = new Map();
  for (const list of Object.values(data.traffic?.referrers ?? {})) {
    for (const r of list) refs.set(r.referrer, (refs.get(r.referrer) ?? 0) + r.count);
  }
  barList($("referrers"), [...refs].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), { limit: 10 });
}

const OUTCOMES = [
  { name: "Success", color: "var(--good)", keys: ["success"] },
  { name: "Failure", color: "var(--critical)", keys: ["failure", "timed_out", "startup_failure"] },
  { name: "Cancelled or skipped", color: "var(--other)", keys: ["cancelled", "skipped", "stale"] },
];

function ciCharts(end) {
  const days = data.actions?.days ?? {};
  const known = Object.keys(days).sort();
  if (!known.length) {
    empty($("runs"), "No workflow runs recorded yet");
    return;
  }
  const start = rangeStart(end, known[0]);
  const from = start < known[0] ? known[0] : start;
  const bucket = bucketBy(rangeDays);
  const sumKeys = (repos, keys) => Object.values(repos ?? {}).reduce((a, c) => a + keys.reduce((b, k) => b + (c[k] ?? 0), 0), 0);
  const all = (repos) => Object.values(repos ?? {}).reduce((a, c) =>
    a + Object.entries(c).reduce((b, [k, v]) => b + (k === "seconds" ? 0 : v), 0), 0);
  const stacks = OUTCOMES.map((o) => {
    const [labels, values] = seriesFromDays(days, from, end, (repos) => sumKeys(repos, o.keys), bucket);
    return { ...o, labels, values };
  });
  const [, totals] = seriesFromDays(days, from, end, all, bucket);
  const known3 = stacks.reduce((a, s) => a.map((v, i) => v + s.values[i]), totals.map(() => 0));
  stacks.push({ name: "Other", color: "var(--warning)", values: totals.map((t, i) => t - known3[i]) });
  columnChart($("runs"), { labels: stacks[0].labels, stacks, title: periodTitle(bucket) });

  const perRepo = new Map();
  for (const [d, repos] of Object.entries(days)) {
    if (d < from) continue;
    for (const [repo, c] of Object.entries(repos)) {
      const cur = perRepo.get(repo) ?? { failed: 0, runs: 0, seconds: 0 };
      for (const [k, v] of Object.entries(c)) {
        if (k === "seconds") cur.seconds += v;
        else {
          cur.runs += v;
          if (OUTCOMES[1].keys.includes(k)) cur.failed += v;
        }
      }
      perRepo.set(repo, cur);
    }
  }
  const span = rangeDays ? `last ${rangeDays} days` : "since tracking began";
  $("failed-cap").textContent = `Failure count and share of runs, ${span}`;
  $("minutes-cap").textContent = `Wall-clock minutes, ${span}`;
  barList($("failed"), [...perRepo].filter(([, c]) => c.failed).map(([label, c]) => ({
    label, value: c.failed, text: `${c.failed} of ${c.runs} (${Math.round((c.failed / c.runs) * 100)}%)`,
  })).sort((a, b) => b.value - a.value));
  barList($("minutes"), [...perRepo].map(([label, c]) => ({ label, value: c.seconds / 60 }))
    .filter((r) => r.value >= 0.5).sort((a, b) => b.value - a.value), { format: (v) => `${fmt(v)} min` });
}

function trends(end) {
  const stars = data.latest.stars;
  if (stars.length) {
    const firstDay = stars[0].date.slice(0, 10);
    const start = rangeStart(end, firstDay);
    const from = start < firstDay ? firstDay : start;
    const perDay = {};
    for (const s of stars) perDay[s.date.slice(0, 10)] = (perDay[s.date.slice(0, 10)] ?? 0) + 1;
    let running = stars.filter((s) => s.date.slice(0, 10) < from).length;
    const labels = [];
    const values = [];
    for (let d = from; d <= end; d = addDays(d, 1)) {
      running += perDay[d] ?? 0;
      labels.push(d);
      values.push(running);
    }
    const recent = stars.slice(-3).reverse().map((s) => `${s.login} → ${s.repo}`).join(", ");
    $("stars-cap").textContent = `Stars on public repositories, cumulative · latest: ${recent}`;
    lineChart($("stars"), { labels, series: [{ name: "Stars", color: "var(--s1)", values }], title: (d) => longDate.format(toTime(d)) });
  } else {
    empty($("stars"), "No stars yet");
  }

  const rows = (data.history ?? []).filter((r) => !rangeDays || r.date >= addDays(end, -(rangeDays - 1)));
  const metrics = [
    ["stars", "Stars"], ["followers", "Followers"], ["commits", "Commits on default branches"],
    ["contributions_year", "Contributions, trailing 12 months"], ["issues_open", "Open issues"], ["views_14", "Views, trailing 14 days"],
  ];
  const grid = $("history");
  grid.replaceChildren();
  // lay out every card before drawing, so each chart measures its final column width
  const charts = metrics.map(([key, name]) => {
    const chart = h("div", { className: "chart" });
    grid.append(h("div", { className: "card" }, h("h3", { text: name }),
      h("p", { className: "cap", text: rows.length > 1 ? `Daily snapshots since ${rows[0].date}` : "Daily snapshots; the line grows with each run" }), chart));
    return chart;
  });
  for (const [i, [key, name]] of metrics.entries()) {
    lineChart(charts[i], {
      labels: rows.map((r) => r.date), height: 140, title: (d) => longDate.format(toTime(d)),
      series: [{ name, color: "var(--s1)", values: rows.map((r) => r[key] ?? 0) }],
    });
  }
}

function renderRanged() {
  for (const b of document.querySelectorAll(".range button")) {
    b.setAttribute("aria-pressed", String(Number(b.dataset.days) === rangeDays));
  }
  const end = data.latest.generated ? toDay(Date.parse(data.latest.generated) + KST) : kstToday();
  activity(end);
  monthly($("pulls-month"), data.latest.pulls.monthly, rangeStart(end, "0000-01-01"));
  monthly($("issues-month"), data.latest.issues.monthly, rangeStart(end, "0000-01-01"));
  trafficCharts(end);
  ciCharts(end);
  trends(end);
}

function renderAll() {
  const end = toDay(Date.parse(data.latest.generated) + KST);
  header();
  tiles();
  calendar($("calendar"), data.latest.contributions.days, end);
  staticActivity();
  repoTable();
  repoLists();
  pullTiles();
  renderRanged();
}

function setupTheme() {
  const root = document.documentElement;
  const saved = store.get("theme");
  if (saved) root.dataset.theme = saved;
  $("theme").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    store.set("theme", root.dataset.theme);
  });
}

async function start() {
  setupTheme();
  try {
    data = await load();
  } catch {
    data = {};
  }
  if (!data.latest) {
    $("meta").textContent = "No data yet: the collector has not run.";
    return;
  }
  renderAll();
  for (const b of document.querySelectorAll(".range button")) {
    b.addEventListener("click", () => {
      rangeDays = Number(b.dataset.days);
      store.set("range", String(rangeDays));
      renderRanged();
    });
  }
  $("repo-filter").addEventListener("input", repoTable);
  $("show-archived").addEventListener("change", repoTable);
  let width = document.querySelector("main").clientWidth;
  let timer;
  new ResizeObserver(() => {
    const now = document.querySelector("main").clientWidth;
    if (now === width) return;
    width = now;
    clearTimeout(timer);
    timer = setTimeout(renderAll, 150);
  }).observe(document.querySelector("main"));
}

start();
