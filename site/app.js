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

/* page */
let data;
let repoSort = { key: "pushed", dir: -1 };

async function load() {
  const names = ["latest", "history", "pypi"];
  const files = await Promise.all(names.map((n) =>
    fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null))));
  return Object.fromEntries(names.map((n, i) => [n, files[i]]));
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
}

function historyDelta(key, value) {
  const rows = data.history ?? [];
  const target = addDays(rows.at(-1)?.date ?? kstToday(), -7);
  const past = rows.filter((r) => r.date <= target).at(-1);
  if (!past || past[key] == null) return null;
  return value - past[key];
}

function sparkline(values, color = "var(--s1)") {
  const n = values.length;
  if (n < 2) return null;
  const max = Math.max(...values, 1);
  const root = svg("svg", { class: "spark", viewBox: `0 0 ${n - 1} 30`, preserveAspectRatio: "none", "aria-hidden": "true" });
  const pts = values.map((v, i) => `${i},${(28 - (v / max) * 26).toFixed(2)}`);
  svg("path", { d: `M0,30L${pts.join("L")}L${n - 1},30Z`, style: `fill:${color};opacity:.1` }, root);
  svg("path", { d: `M${pts.join("L")}`, fill: "none", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke",
    "stroke-linejoin": "round", style: `stroke:${color}` }, root);
  return root;
}

function change([now, before], label = "vs prior 7 days") {
  if (!before) return null;
  const pct = Math.round((100 * (now - before)) / before);
  return [h("span", { className: `delta ${pct >= 0 ? "up" : "down"}`, text: `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%` }), ` ${label}`];
}

function tile(label, value, { sub, delta, deltaKey, spark } = {}) {
  const node = h("div", { className: "tile" }, h("div", { className: "label", text: label }),
    h("div", { className: "value", text: typeof value === "number" ? fmt(value) : value }));
  const subLine = h("div", { className: "sub" });
  const history = deltaKey ? historyDelta(deltaKey, value) : null;
  const parts = delta ?? (history ? [h("span", { className: `delta ${history > 0 ? "up" : "down"}`, text: `${history > 0 ? "+" : "−"}${fmt(Math.abs(history))}` }), " vs 7 days ago"] : null);
  if (parts) subLine.append(...parts);
  if (parts && sub) subLine.append(h("br"));
  if (sub) subLine.append(sub);
  node.append(subLine);
  const line = spark ? sparkline(spark) : null;
  if (line) node.append(line);
  return node;
}

function lastDays(map, n, end, valueOf = (v) => v ?? 0) {
  return Array.from({ length: n }, (_, i) => valueOf(map[addDays(end, i - n + 1)]));
}

function tiles(end) {
  const s = data.latest;
  const t = s.totals;
  const ly = s.contributions.last_year;
  let stars = s.stars.filter((x) => x.date.slice(0, 10) <= addDays(end, -90)).length;
  const starDays = {};
  for (const x of s.stars) starDays[x.date.slice(0, 10)] = (starDays[x.date.slice(0, 10)] ?? 0) + 1;
  const starLine = lastDays(starDays, 90, end).map((v) => (stars += v));
  const followers = (data.history ?? []).slice(-30).map((r) => r.followers);
  const recent = s.pulse?.contributions;
  $("tiles").replaceChildren(
    tile("Contributions, 12 months", t.contributions_year, {
      delta: recent ? [`${fmt(recent[0])} in the last 7 days `, ...(change(recent, "") ?? [])] : null,
      sub: `${fmt(ly.commits)} commits · ${fmt(ly.pulls)} PRs · ${fmt(ly.issues)} issues`,
      spark: lastDays(s.contributions.days, 30, end),
    }),
    tile("Stars", t.stars, { sub: `${fmt(t.forks)} forks`, deltaKey: "stars", spark: starLine }),
    tile("Followers", t.followers, { sub: `following ${fmt(s.profile.following)}`, deltaKey: "followers", spark: followers }),
    tile("Repositories", t.repos_public + t.repos_private, { sub: `${t.repos_public} public · ${t.repos_private} private` }),
  );
}

function years() {
  const items = Object.entries(data.latest.contributions.years);
  const pick = (k) => items.map(([, y]) => y[k]);
  columnChart($("years"), {
    labels: items.map(([y]) => y),
    stacks: [
      { name: "Commits", color: "var(--s1)", values: pick("commits") },
      { name: "Pull requests", color: "var(--s2)", values: pick("pulls") },
      { name: "Issues", color: "var(--s3)", values: pick("issues") },
      { name: "Reviews and new repos", color: "var(--s4)", values: items.map(([, y]) => y.reviews + y.repos) },
      { name: "Private", color: "var(--other)", values: pick("restricted") },
    ],
  });
}

const REPO_COLUMNS = [
  { key: "name", label: "Repository" },
  { key: "language", label: "Language" },
  { key: "stars", label: "Stars", num: true },
  { key: "forks", label: "Forks", num: true },
  { key: "commits_year", label: "Commits 1y", num: true },
  { key: "commits", label: "Commits", num: true },
  { key: "releases", label: "Release", num: true },
  { key: "pushed", label: "Last push" },
];

function relative(iso) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / DAY);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return monthYear.format(Date.parse(iso));
}

function repoTable() {
  const s = data.latest;
  const query = $("repo-filter").value.trim().toLowerCase();
  const archived = $("show-archived").checked;
  const col = REPO_COLUMNS.find((c) => c.key === repoSort.key);
  const value = (r) => r[col.key] ?? (col.num ? -1 : "");
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
      ...["stars", "forks", "commits_year", "commits"].map((k) => h("td", { className: "num", text: fmt(r[k]) })),
      h("td", { className: "num", text: r.latest_release ? r.latest_release.tagName : fmt(r.releases) }),
      h("td", { text: r.pushed ? relative(r.pushed) : "–", title: r.pushed ?? "" }),
    ));
  }
  const p = s.private;
  if (p?.count) {
    body.append(h("tr", { className: "agg" },
      h("td", { text: `${p.count} private repositories` }), h("td", { text: "" }),
      h("td", { className: "num", text: fmt(p.stars) }), h("td", { className: "num", text: "–" }),
      h("td", { className: "num", text: fmt(p.commits_year) }), h("td", { className: "num", text: fmt(p.commits) }),
      h("td", { className: "num", text: "–" }), h("td", { text: "" })));
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

function upstreamTable() {
  const table = $("upstream");
  const rows = data.latest.pulls.elsewhere;
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

function starsChart(end) {
  const stars = data.latest.stars;
  if (!stars.length) return empty($("stars"), "No stars yet");
  const perDay = {};
  for (const s of stars) perDay[s.date.slice(0, 10)] = (perDay[s.date.slice(0, 10)] ?? 0) + 1;
  let running = 0;
  const labels = [];
  const values = [];
  for (let d = stars[0].date.slice(0, 10); d <= end; d = addDays(d, 1)) {
    running += perDay[d] ?? 0;
    labels.push(d);
    values.push(running);
  }
  const recent = stars.slice(-3).reverse().map((s) => `${s.login} → ${s.repo}`).join(", ");
  $("stars-cap").textContent = `Stars on public repositories, cumulative · latest: ${recent}`;
  lineChart($("stars"), { labels, series: [{ name: "Stars", color: "var(--s1)", values }], title: (d) => longDate.format(toTime(d)) });
}

function pypiTable() {
  const table = $("pypi-table");
  const p = data.pypi;
  if (!p?.packages?.length) {
    $("pypi-cap").textContent = p ? "No public repository has a package on PyPI" : "Not collected yet";
    table.replaceChildren();
    return;
  }
  const count = (n) => (n == null ? "–" : fmt(n));
  const asOf = p.packages.map((pkg) => pkg.downloads.as_of).filter(Boolean).sort().at(-1);
  $("pypi-cap").textContent = `${fmt(p.downloads_month)} downloads in 30 days${asOf ? ` to ${asOf}` : ""}, from pypistats.org without mirrors`;
  // A phone shows the 30-day count only; 7 days and the repository join on a wider screen.
  const head = [["Package", ""], ["Version", ""], ["Released", ""], ["30 days", "num"], ["7 days", "num wide-only"], ["Repository", "wide-only"]];
  table.replaceChildren(
    h("thead", {}, h("tr", {}, ...head.map(([text, className]) => h("th", { className, text })))),
    h("tbody", {}, ...p.packages.map((pkg) => h("tr", {},
      h("td", {}, h("a", { href: pkg.url, text: pkg.package })),
      h("td", { text: pkg.version }),
      h("td", { text: pkg.released ? pkg.released.slice(0, 10) : "–" }),
      h("td", { className: "num", text: count(pkg.downloads.month) }),
      h("td", { className: "num wide-only", text: count(pkg.downloads.week) }),
      h("td", { className: "wide-only", text: pkg.repo }))),
    ));
}

function renderAll() {
  const end = toDay(Date.parse(data.latest.generated) + KST);
  header();
  tiles(end);
  calendar($("calendar"), data.latest.contributions.days, end);
  years();
  repoTable();
  repoLists();
  pypiTable();
  upstreamTable();
  starsChart(end);
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
