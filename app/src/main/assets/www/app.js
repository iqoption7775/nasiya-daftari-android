/* Nasiya daftari — oddiy versiya. Server yo'q: ma'lumotlar faqat shu telefonda saqlanadi.
   Obuna: 30 kun bepul, keyin faollashtirish kodi (raqamli imzo bilan tekshiriladi).
   SMS: Android ilovasida telefon SIM kartasidan bir tugmada hammaga; brauzerda navbat bilan. */
(function () {
"use strict";

/* ===== SOZLAMALAR — kerak bo'lsa shu yerni o'zgartiring ===== */
var APP_VERSION = "2026-10-31-1"; // yangilashda version.json bilan birga o'zgartiriladi
var CONFIG = {
  price: 200000,             // oylik obuna narxi, so'mda
  usdRate: 12023,            // dollar kursi (Markaziy bank, 31.10.2026), internet bo'lmasa shu ishlatiladi
  trialDays: 30,
  telegram: "Abdu_invest",
  paymentText: "Oylik obuna 200 000 so‘m. To‘lov karta yoki Payme/Click orqali. Telegram'ga yozing: qurilma kodingizni yuboring, to‘lovdan so‘ng faollashtirish kodini olasiz.",
  smsDelayMs: 3000, // Android'da SMS'lar orasidagi pauza (operator spam deb hisoblamasligi uchun)
  publicKey: { kty:"EC", crv:"P-256", x:"TI1BF8xn3f5akS_K5HxHZ8kvmHDZo2xs8WZ7RpPDbI8", y:"cjg8hQwwkVBgM28h7SuTRolHUIxpjbqwb7_rrfgBP4U" }
};
var DEFAULT_TPL = {
  today: "Assalomu alaykum, {ism}! Bugun {nima} uchun to'lov kuningiz: {summa}. Iltimos, to'lovni o'z vaqtida amalga oshiring.",
  late:  "Assalomu alaykum, {ism}! {nima} uchun {sana} kungi to'lovingiz kechikmoqda. To'lanishi kerak: {summa}. Iltimos, to'lovni tezroq amalga oshiring.",
  soon:  "Assalomu alaykum, {ism}! Eslatma: {nima} uchun to'lov kuni {sana}. To'lov summasi: {summa}."
};
/* =========================================================== */

var $ = function (s) { return document.querySelector(s); };
var noop = function () {};
var MONTHS = ["yanvar","fevral","mart","aprel","may","iyun","iyul","avgust","sentabr","oktabr","noyabr","dekabr"];
var WEEK = ["yakshanba","dushanba","seshanba","chorshanba","payshanba","juma","shanba"];
var DATA_KEY = "nasiya-daftari-v1";
var META_KEY = "nasiya-daftari-meta";
var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

var TABS = [
  {id:"today",  label:"Bugun",            title:"Bugun to‘lashi kerak",       empty:"Bugun to‘lov kuni bo‘lgan nasiya yo‘q."},
  {id:"late",   label:"Muddati o‘tgan",   title:"Muddati o‘tgan nasiyalar",   empty:"Muddati o‘tgan nasiya yo‘q."},
  {id:"soon",   label:"Muddati kelmagan", title:"Muddati kelmagan nasiyalar", empty:"Muddati kelmagan nasiya yo‘q."},
  {id:"closed", label:"Yopilgan",         title:"To‘liq yopilgan nasiyalar",  empty:"Hali to‘liq yopilgan nasiya yo‘q."}
];
var ICON = {
  bell:'<svg class="ico bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  clock:'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  book:'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/></svg>',
  sms:'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg>',
  check:'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>'
};

function pad(n){ return String(n).padStart(2,"0"); }
function todayISO(){ var d = new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function newId(){ return "n"+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

var state = { items:[], tab:null, q:"", today:todayISO(), armSamples:false, armedPay:null, openHist:new Set(), storageOk:true };
var meta = {};

/* ---------- sana va pul ---------- */
function isIso(v){ return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }
function dayNum(iso){ if(!isIso(iso)) return NaN; var p = iso.split("-").map(Number); return Math.round(Date.UTC(p[0], p[1]-1, p[2]) / 86400000); }
function isoFromUTC(dt){ return dt.getUTCFullYear()+"-"+pad(dt.getUTCMonth()+1)+"-"+pad(dt.getUTCDate()); }
function addDays(iso, n){ return isoFromUTC(new Date((dayNum(iso)+n) * 86400000)); }
function addMonths(iso, n){
  var p = iso.split("-").map(Number);
  var dt = new Date(Date.UTC(p[0], p[1]-1+n, 1));
  var last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth()+1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(p[2], last));
  return isoFromUTC(dt);
}
function fmtDate(iso, forceYear){
  if(!isIso(iso)) return "—";
  var p = iso.split("-").map(Number), curY = Number(state.today.slice(0,4));
  return p[2]+"-"+MONTHS[p[1]-1]+((forceYear || p[0] !== curY) ? " "+p[0] : "");
}
function fmtLong(iso){ var p = iso.split("-").map(Number); return p[2]+"-"+MONTHS[p[1]-1]+" "+p[0]+", "+WEEK[new Date(Date.UTC(p[0], p[1]-1, p[2])).getUTCDay()]; }
function grp(n){ var v = Math.round(Math.abs(Number(n) || 0)); return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function moneyParts(n, cur){ return cur === "USD" ? {n:"$"+grp(n), c:""} : {n:grp(n), c:"so‘m"}; }
function money(n, cur){ var p = moneyParts(n, cur); return p.c ? p.n+" "+p.c : p.n; }
function smsMoney(n, cur){ var s = grp(n).replace(/ /g, " "); return cur === "USD" ? s+"$" : s+" so'm"; }
function parseMoney(v){ var d = String(v || "").replace(/\D/g,""); return d ? Number(d) : 0; }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function validPhone(p){ var d = String(p || "").replace(/\D/g, ""); return d.length === 9 || (d.length === 12 && d.indexOf("998") === 0); }
function intlPhone(p){ var d = String(p || "").replace(/\D/g, ""); if(d.length === 9) d = "998"+d; return d.length === 12 ? "+"+d : ""; }
function prettyPhone(p){ var d = intlPhone(p).slice(1); if(!d) return String(p || ""); return "+998 "+d.slice(3,5)+" "+d.slice(5,8)+" "+d.slice(8,10)+" "+d.slice(10,12); }

/* ---------- nasiya hisobi (bo'lib to'lash bilan) ---------- */
function curOf(it){ return it.currency === "USD" ? "USD" : "UZS"; }
function amtOf(it){ return Number(it.amount) || 0; }
function paidOf(it){ return (Array.isArray(it.payments) ? it.payments : []).reduce(function(s,p){ return s + (Number(p && p.amount) || 0); }, 0); }
function remOf(it){ return Math.max(0, Math.round((amtOf(it) - paidOf(it)) * 100) / 100); }
function hasPlan(it){ return Array.isArray(it.schedule) && it.schedule.length > 1; }
function scheduleOf(it){ return Array.isArray(it.schedule) && it.schedule.length ? it.schedule : [{ date:it.dueDate, amount:amtOf(it) }]; }

function buildSchedule(total, count, every, first){
  var base = Math.floor(total / count), out = [];
  for(var i = 0; i < count; i++){
    out.push({ date: every === "week" ? addDays(first, 7*i) : addMonths(first, i), amount: i === count-1 ? Math.round((total - base*(count-1)) * 100) / 100 : base });
  }
  return out;
}

/* To'lovlar jadvaldagi eng eski qismlarga taqsimlanadi. */
function planInfo(it){
  var sch = scheduleOf(it), paid = paidOf(it), cum = 0, rows = [], first = -1, t = state.today;
  for(var i = 0; i < sch.length; i++){
    var a = Number(sch[i].amount) || 0;
    cum += a;
    var got = Math.min(a, Math.max(0, paid - (cum - a)));
    var done = paid + 1e-6 >= cum;
    rows.push({ date:sch[i].date, amount:a, paid:got, left:Math.round((a - got) * 100) / 100, done:done });
    if(first < 0 && !done) first = i;
  }
  var dueNow = 0;
  rows.forEach(function(r){ if(!r.done && r.date <= t) dueNow += r.left; });
  return { rows:rows, next:first >= 0 ? rows[first] : null, dueNow:Math.round(dueNow * 100) / 100, paidCount:rows.filter(function(r){ return r.done; }).length };
}
function effDue(it){ var p = planInfo(it); return p.next ? p.next.date : it.dueDate; }
function diffDays(it){ return dayNum(effDue(it)) - dayNum(state.today); }
function statusOf(it){
  if(it.closed || remOf(it) <= 0) return "closed";
  var d = diffDays(it);
  if(d < 0) return "late";
  if(d === 0) return "today";
  return "soon";
}
/* Hozir to'lanishi kerak bo'lgan summa (bugungi + kechikkan qismlar), aks holda keyingi qism. */
function dueAmt(it){
  var p = planInfo(it);
  if(p.dueNow > 0) return p.dueNow;
  return p.next ? p.next.left : 0;
}
function compute(){
  var g = {today:[], late:[], soon:[], closed:[]};
  state.items.forEach(function(it){ g[statusOf(it)].push(it); });
  var byDue = function(a,b){ return (dayNum(effDue(a))||0) - (dayNum(effDue(b))||0); };
  g.today.sort(function(a,b){ return dueAmt(b) - dueAmt(a); });
  g.late.sort(byDue); g.soon.sort(byDue);
  g.closed.sort(function(a,b){ return String(b.closedAt||"").localeCompare(String(a.closedAt||"")); });
  return g;
}
function sumBy(arr, fn){ var m = {UZS:0, USD:0}; arr.forEach(function(it){ m[curOf(it)] += fn(it); }); return m; }
function entries(m){ var e = []; if(m.UZS > 0) e.push(["UZS", m.UZS]); if(m.USD > 0) e.push(["USD", m.USD]); return e.length ? e : [["UZS", 0]]; }
function moneyLine(m){ return entries(m).map(function(x){ return money(x[1], x[0]); }).join(" + "); }
/* Dollar kursi: biznes o'zi yozgan kurs, bo'lmasa Markaziy bank kursi (har kuni yangilanadi). */
function usdRate(){ var u = meta.usd; return u && u.rate > 0 ? u.rate : CONFIG.usdRate; }
function rateText(){ return "1$ = "+grp(usdRate())+" so‘m"; }
function toUZS(m){ return Math.round((m.UZS || 0) + (m.USD || 0) * usdRate()); }
function parseRate(v){ var t = String(v || "").replace(/\s/g, ""), x = t.match(/^(\d+)(?:[.,](\d+))?$/); return x ? Number(x[1]+"."+(x[2] || "0")) : 0; }
function refreshRate(){
  if(!window.fetch || (meta.usd && (meta.usd.src === "manual" || meta.usd.date === state.today))) return;
  var ctl = window.AbortController ? new AbortController() : null;
  if(ctl) setTimeout(function(){ ctl.abort(); }, 8000);
  fetch("https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/", ctl ? {signal:ctl.signal} : {}).then(function(r){ return r.ok ? r.json() : null; }).then(function(j){
    var rate = j && j[0] ? parseRate(j[0].Rate) : 0;
    if(!(rate > 1000 && rate < 100000) || (meta.usd && meta.usd.src === "manual")) return;
    meta.usd = {rate:rate, date:state.today, src:"cbu"}; saveMeta(); render();
  }).catch(noop);
}
function tabSum(id){ return id === "closed" ? amtOf : (id === "soon" ? remOf : dueAmt); }
function find(id){ return state.items.filter(function(x){ return x.id === id; })[0]; }

/* ---------- SMS: qoida va matn ---------- */
/* Bugun kimga SMS: to'lov kuni bugun, yoki kechikkan bo'lsa har 7 kunda bir marta. */
function smsKind(it){
  if(statusOf(it) === "closed") return null;
  var p = planInfo(it); if(!p.next) return null;
  var t = state.today, late = dayNum(t) - dayNum(p.next.date);
  var dueToday = p.rows.some(function(r){ return !r.done && r.date === t; });
  if(late > 0) return (dueToday || late % 7 === 0) ? "late" : null;
  if(late === 0) return "today";
  return null;
}
function tpl(){ var t = meta.tpl || {}; return { today:t.today || DEFAULT_TPL.today, late:t.late || DEFAULT_TPL.late, soon:t.soon || DEFAULT_TPL.soon }; }
function fillTpl(text, v){
  var s = String(text);
  if(!v.nima) s = s.replace(/\{nima\}\s*uchun\s*/gi, "").replace(/\{nima\}\s*/gi, "");
  s = s.replace(/\{ism\}/gi, v.ism).replace(/\{nima\}/gi, v.nima).replace(/\{summa\}/gi, v.summa).replace(/\{sana\}/gi, v.sana).replace(/\{biznes\}/gi, v.biznes);
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
  s = s.replace(/([.!?]\s+)([a-zа-я])/g, function(_, a, b){ return a + b.toUpperCase(); });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function smsText(it, kind){
  kind = kind || smsKind(it) || (statusOf(it) === "late" ? "late" : statusOf(it) === "today" ? "today" : "soon");
  var p = planInfo(it), cur = curOf(it);
  var sum = kind === "soon" ? (p.next ? p.next.left : remOf(it)) : (p.dueNow || (p.next ? p.next.left : remOf(it)));
  var date = p.next ? p.next.date : it.dueDate;
  return fillTpl(tpl()[kind], {
    ism: String(it.name || "").trim(), nima: String(it.note || "").trim().slice(0, 60),
    summa: smsMoney(sum, cur), sana: fmtDate(date), biznes: meta.business || ""
  });
}
function smsCount(text){
  var uni = /[^\x20-\x7E\n]/.test(text), one = uni ? 70 : 160, multi = uni ? 67 : 153;
  return { n: text.length <= one ? 1 : Math.ceil(text.length / multi), len:text.length, uni:uni };
}
function sentToday(it){ return it.sms && it.sms.last === state.today; }
function markSent(id){
  state.items = state.items.map(function(x){
    if(x.id !== id) return x;
    var s = x.sms || {}; return Object.assign({}, x, { sms:{ last:state.today, n:(s.n || 0) + 1 } });
  });
  saveItems();
}
function todaysSms(){
  var all = state.items.filter(function(it){ return smsKind(it) && validPhone(it.phone); });
  return { pending: all.filter(function(it){ return !sentToday(it); }), sent: all.filter(sentToday), noPhone: state.items.filter(function(it){ return smsKind(it) && !validPhone(it.phone); }) };
}

/* ---------- saqlash ---------- */
function loadItems(){ try { var v = JSON.parse(localStorage.getItem(DATA_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch(e){ return []; } }
function saveItems(){
  try { localStorage.setItem(DATA_KEY, JSON.stringify(state.items)); state.storageOk = true; } catch(e){ state.storageOk = false; }
  try { if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(noop); } catch(e){}
}
function loadMeta(){ try { meta = JSON.parse(localStorage.getItem(META_KEY) || "{}") || {}; } catch(e){ meta = {}; } }
function saveMeta(){ try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch(e){} }
function commit(fn){ fn(); saveItems(); render(); }

/* ---------- obuna va faollashtirish ---------- */
var B32 = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
function makeDeviceId(){
  var a = new Uint8Array(8), s = "";
  try { crypto.getRandomValues(a); } catch(e){ for(var j=0;j<8;j++) a[j] = Math.floor(Math.random()*256); }
  for(var i=0;i<8;i++) s += B32[a[i] % B32.length];
  return s.slice(0,4)+"-"+s.slice(4);
}
function ensureMeta(){
  var changed = false;
  if(!meta.deviceId){ meta.deviceId = makeDeviceId(); changed = true; }
  if(!isIso(meta.installedAt)){ meta.installedAt = todayISO(); changed = true; }
  if(!Array.isArray(meta.licenses)){ meta.licenses = []; changed = true; }
  var t = todayISO();
  if(!isIso(meta.maxSeen) || t > meta.maxSeen){ meta.maxSeen = t; changed = true; }
  if(changed) saveMeta();
}
/* Soatni orqaga qaytarib muddatni uzaytirib bo'lmasin: ko'rilgan eng katta sana ishlatiladi. */
function licToday(){ var t = todayISO(); return meta.maxSeen && meta.maxSeen > t ? meta.maxSeen : t; }
function sub(){
  var t = licToday();
  var trialLast = addDays(meta.installedAt, CONFIG.trialDays - 1);
  var paidLast = meta.licenses.reduce(function(m, l){ return l.u > m ? l.u : m; }, "");
  var status, until;
  /* Kod kiritilgan bo'lsa, sinov davrida ham "Obuna faol" ko'rinadi. */
  if(paidLast && t <= paidLast){ status = "active"; until = paidLast > trialLast ? paidLast : trialLast; }
  else if(t <= trialLast){ status = "trial"; until = trialLast; }
  else { status = "expired"; until = paidLast > trialLast ? paidLast : trialLast; }
  return { status:status, until:until, trialLast:trialLast, daysLeft: Math.max(0, dayNum(until) - dayNum(t) + 1), canWrite: status !== "expired" };
}
function canWrite(){ return sub().canWrite; }
function b64urlBytes(s){
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while(s.length % 4) s += "=";
  var bin = atob(s), u = new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
  return u;
}
var keyPromise = null;
function publicKey(){ if(!keyPromise) keyPromise = crypto.subtle.importKey("jwk", CONFIG.publicKey, {name:"ECDSA", namedCurve:"P-256"}, false, ["verify"]); return keyPromise; }
function activate(raw){
  var code = String(raw || "").replace(/\s+/g, ""), parts = code.split(".");
  if(parts.length !== 3 || parts[0] !== "ND1") return Promise.reject(new Error("Kod formati noto‘g‘ri. Kodni to‘liq nusxalab qo‘ying."));
  if(!window.crypto || !crypto.subtle) return Promise.reject(new Error("Bu brauzer kodni tekshira olmaydi. Ilovani https manzildan oching."));
  var payload, sig;
  try { payload = b64urlBytes(parts[1]); sig = b64urlBytes(parts[2]); } catch(e){ return Promise.reject(new Error("Kod formati noto‘g‘ri.")); }
  return publicKey().then(function(k){ return crypto.subtle.verify({name:"ECDSA", hash:"SHA-256"}, k, sig, payload); }).then(function(ok){
    if(!ok) throw new Error("Kod noto‘g‘ri yoki o‘zgartirilgan.");
    var p = JSON.parse(new TextDecoder().decode(payload));
    if(p.d !== meta.deviceId) throw new Error("Bu kod boshqa qurilma uchun berilgan. Qurilma kodingiz: "+meta.deviceId);
    if(!isIso(p.u)) throw new Error("Kod formati noto‘g‘ri.");
    if(meta.licenses.some(function(l){ return l.c === code; })) throw new Error("Bu kod allaqachon kiritilgan.");
    meta.licenses.push({ u:p.u, i:p.i || "", c:code, at:todayISO() });
    saveMeta();
    return p;
  });
}

/* ---------- chizish ---------- */
function setHTML(el, html){ if(el._h !== html){ el.innerHTML = html; el._h = html; } }
function pickTab(){ var g = compute(); return g.today.length ? "today" : g.late.length ? "late" : g.soon.length ? "soon" : "today"; }

function render(){
  var g = compute();
  $("#biz-name").textContent = meta.business || "Nasiya daftari";
  $("#today-label").textContent = fmtLong(state.today);
  renderSubLine(); renderBanner(); renderSheet(g); renderAlerts(g); renderList(g);
  var w = canWrite();
  $("#fab").hidden = !w;
  document.querySelector(".add-top").hidden = !w;
  updateBadge(g);
}
function renderSubLine(){
  var s = sub(), el = $("#sub-line"), txt, cls = "";
  if(!state.storageOk){ txt = "Saqlab bo‘lmayapti"; cls = "bad"; }
  else if(s.status === "trial"){ txt = "Bepul sinov · "+s.daysLeft+" kun qoldi"; if(s.daysLeft <= 7) cls = "warn"; }
  else if(s.status === "active"){ txt = "Obuna faol · "+fmtDate(s.until)+" gacha"; if(s.daysLeft <= 5) cls = "warn"; }
  else { txt = "Obuna tugagan"; cls = "bad"; }
  el.textContent = txt; el.className = "sub-line" + (cls ? " "+cls : "");
}
function renderBanner(){
  var s = sub(), html = "";
  var pay = '<button type="button" class="btn btn-sm btn-primary" data-open="dlg-sub">Obunani yangilash</button>';
  if(s.status === "expired") html = '<div class="banner banner-bad"><p><b>Obuna muddati tugagan.</b> Ma’lumotlaringiz saqlangan va ko‘rinib turibdi, lekin yangi yozuv qo‘shib bo‘lmaydi va SMS yuborilmaydi.</p>'+pay+'</div>';
  else if(s.status === "trial" && s.daysLeft <= 7) html = '<div class="banner banner-warn"><p><b>Bepul sinov '+s.daysLeft+' kundan keyin tugaydi.</b> Ishni to‘xtatmaslik uchun obunani oldindan faollashtiring.</p>'+pay+'</div>';
  else if(s.status === "active" && s.daysLeft <= 5) html = '<div class="banner banner-warn"><p><b>Obuna '+s.daysLeft+' kundan keyin tugaydi.</b> Keyingi oyni oldindan to‘lab qo‘ying.</p>'+pay+'</div>';
  setHTML($("#banner"), html);
}
function renderSheet(g){
  var open = g.today.concat(g.late, g.soon);
  var e = entries(sumBy(open, remOf)), p = moneyParts(e[0][1], e[0][0]);
  setHTML($("#total"), '<span class="n">'+esc(p.n)+'</span>'+(p.c ? '<span class="c">'+p.c+'</span>' : ""));
  setHTML($("#total-extra"), e.slice(1).map(function(x){ return '<span class="num">+ '+esc(money(x[1], x[0]))+'</span>'; }).join("") + '<span>'+open.length+' ta ochiq nasiya</span>');
  setHTML($("#tiles"), TABS.map(function(t){
    var arr = g[t.id];
    var m = sumBy(arr, tabSum(t.id));
    var sums = t.id === "closed"
      ? '<span>'+esc(money(toUZS(m), "UZS"))+'</span>'+(m.USD > 0 ? '<span class="tile-rate">'+esc(rateText())+'</span>' : "")
      : entries(m).map(function(x){ return '<span>'+esc(money(x[1], x[0]))+'</span>'; }).join("");
    return '<button type="button" class="tile tile-'+t.id+'" role="tab" aria-selected="'+(state.tab === t.id)+'" aria-controls="list" data-tab="'+t.id+'">'
      + '<span class="tile-label"><i class="dot"></i>'+t.label+'</span><span class="tile-count">'+arr.length+'<small> ta</small></span>'
      + '<span class="tile-sum">'+sums+'</span></button>';
  }).join(""));
}
function names(arr){ var n = arr.map(function(i){ return esc(i.name || "Nomsiz"); }); return n.length <= 3 ? n.join(", ") : n.slice(0,3).join(", ")+" va yana "+(n.length-3)+" kishi"; }
function renderAlerts(g){
  var html = "", ts = todaysSms(), native = !!nativeSms();
  if(ts.pending.length && canWrite()){
    html += '<div class="smsbar">'+ICON.sms+'<p><b>Bugun '+ts.pending.length+' kishiga SMS yuborish kerak</b>'
      + '<span>'+(native ? "Telefoningiz SIM kartasidan, har biriga o‘z summasi bilan" : "Har biriga o‘z summasi bilan tayyor matn")+'</span></p>'
      + '<button type="button" class="btn btn-sm" data-open="dlg-bulk">'+(native ? "Hammasiga yuborish" : "Yuborish")+'</button></div>';
  } else if(ts.sent.length){
    html += '<div class="smsbar done">'+ICON.check+'<p><b>Bugungi SMS’lar yuborildi: '+ts.sent.length+' ta</b><span>Keyingi eslatmalar to‘lov kunlarida chiqadi</span></p></div>';
  }
  function block(kind, list, icon, title){
    return '<div class="alert alert-'+kind+'"><button type="button" class="alert-main" data-tab="'+kind+'" data-jump="1">'+icon
      + '<span class="alert-txt"><b>'+title+'</b><span>'+names(list)+'</span><span class="num">'+esc(moneyLine(sumBy(list, dueAmt)))+'</span></span></button></div>';
  }
  if(g.today.length) html += block("today", g.today, ICON.bell, "Bugun "+g.today.length+" kishi to‘lashi kerak");
  if(g.late.length) html += block("late", g.late, ICON.clock, g.late.length+" ta nasiyaning to‘lovi kechikkan");
  if(state.items.some(function(i){ return i.sample; })){
    html += '<div class="notice"><p>Hozirgi yozuvlar namuna. O‘z mijozlaringizni kiritishdan oldin ularni o‘chirib tashlang.</p>'
      + '<button type="button" class="btn btn-sm'+(state.armSamples ? ' btn-danger armed' : '')+'" id="clear-samples">'+(state.armSamples ? "Ha, o‘chirish" : "Namunalarni o‘chirish")+'</button></div>';
  }
  setHTML($("#alerts"), html);
}
function card(it){
  var st = statusOf(it), d = diffDays(it), cur = curOf(it), amt = amtOf(it), paid = paidOf(it), rem = remOf(it);
  var plan = hasPlan(it), p = planInfo(it), id = esc(it.id), w = canWrite();
  var big, label;
  if(st === "closed"){ big = amt; label = "jami"; }
  else if(plan){ big = dueAmt(it); label = st === "soon" ? "keyingi to‘lov" : "to‘lov"; }
  else { big = rem; label = "qoldiq"; }
  var mp = moneyParts(big, cur);
  var pill;
  if(st === "closed") pill = '<span class="pill pill-closed">To‘landi'+(it.closedAt ? " · "+esc(fmtDate(it.closedAt)) : "")+'</span>';
  else if(st === "today") pill = '<span class="pill pill-today">Bugun to‘lov kuni</span>';
  else if(st === "late") pill = '<span class="pill pill-late'+(-d > 7 ? " pill-strong" : "")+'">'+(-d)+' kun kechikdi</span>';
  else pill = '<span class="pill pill-soon">'+(d === 1 ? "Ertaga" : isNaN(d) ? "Sana yo‘q" : d+" kundan keyin")+'</span>';
  var planLine = plan && st !== "closed"
    ? '<p class="plan-line">Bo‘lib to‘lash: <b>'+p.paidCount+' / '+p.rows.length+'</b> to‘langan · jami qoldiq <b>'+esc(money(rem, cur))+'</b></p>' : "";
  var prog = (paid > 0 && st !== "closed") ? '<div class="prog"><div class="bar"><i style="width:'+Math.min(100, Math.round(paid / (amt || 1) * 100))+'%"></i></div><span>To‘langan '+esc(money(paid, cur))+' / '+esc(money(amt, cur))+'</span></div>' : "";
  var sched = plan ? '<details class="hist" data-id="'+id+'s"'+(state.openHist.has(it.id+"s") ? " open" : "")+'><summary>To‘lov jadvali ('+p.rows.length+')</summary><ul class="sched">'
    + p.rows.map(function(r){
        var s = r.done ? '<span class="pill pill-closed">to‘langan</span>'
          : r.date < state.today ? '<span class="pill pill-late">kechikkan</span>'
          : r.date === state.today ? '<span class="pill pill-today">bugun</span>'
          : r.paid > 0 ? '<span class="pill pill-soon">qisman</span>' : '<span class="pill pill-muted">kutilmoqda</span>';
        return '<li><span>'+esc(fmtDate(r.date, true))+'</span><span class="num">'+esc(money(r.amount, cur))+(r.paid > 0 && !r.done ? ' <small>(qoldi '+esc(money(r.left, cur))+')</small>' : '')+'</span>'+s+'</li>';
      }).join("")+'</ul></details>' : "";
  var pays = Array.isArray(it.payments) ? it.payments : [];
  var hist = pays.length ? '<details class="hist" data-id="'+id+'"'+(state.openHist.has(it.id) ? " open" : "")+'><summary>To‘lovlar tarixi ('+pays.length+')</summary><ul>'
    + pays.map(function(pp, i){
        var key = it.id+":"+i, armed = state.armedPay === key;
        return '<li><span>'+esc(fmtDate(pp.date, true))+'</span><span class="num">'+esc(money(pp.amount, cur))+'</span>'
          + (w ? '<button type="button" class="x" data-act="unpay" data-id="'+id+'" data-i="'+i+'">'+(armed ? "Ha, o‘chirish" : "Bekor qilish")+'</button>' : '')+'</li>';
      }).join("")+'</ul></details>' : "";
  var actions;
  if(st === "closed") actions = w ? '<div class="actions"><button type="button" class="btn btn-sm btn-ghost" data-act="edit" data-id="'+id+'">Tahrirlash</button></div>' : "";
  else if(!w) actions = "";
  else actions = '<div class="actions"><button type="button" class="btn btn-sm btn-soft" data-act="pay" data-id="'+id+'">To‘lov olish</button>'
    + '<button type="button" class="btn btn-sm" data-act="remind" data-id="'+id+'">'+ICON.sms+'SMS</button>'
    + '<button type="button" class="btn btn-sm btn-ghost" data-act="edit" data-id="'+id+'">Tahrirlash</button></div>';
  return '<article class="debt st-'+st+'"><div class="debt-head"><div class="who"><h3>'+esc(it.name || "Nomsiz")+'</h3>'
    + (it.phone ? '<span class="phone">'+esc(prettyPhone(it.phone))+'</span>' : "")+'</div>'
    + '<div class="amt"><small>'+label+'</small><span class="amt-num">'+esc(mp.n)+(mp.c ? ' <span class="amt-cur">'+mp.c+'</span>' : "")+'</span></div></div>'
    + (it.note ? '<p class="note">'+esc(it.note)+'</p>' : "")
    + '<div class="meta">'+pill+'<span>'+(plan && st !== "closed" ? "To‘lov kuni" : "Muddat")+': '+esc(fmtDate(st === "closed" ? it.dueDate : effDue(it)))+'</span>'
    + (sentToday(it) ? '<span class="sent-tag">'+ICON.check+'SMS yuborildi</span>' : "")
    + (it.sample ? '<span class="pill pill-muted">Namuna</span>' : "")+'</div>'
    + planLine + prog + sched + hist + actions + '</article>';
}
function renderList(g){
  var tab = TABS.filter(function(t){ return t.id === state.tab; })[0] || TABS[0], arr = g[tab.id];
  var q = state.q.trim().toLowerCase();
  if(q){
    var qd = q.replace(/\D/g, "");
    arr = arr.filter(function(it){ return String(it.name||"").toLowerCase().indexOf(q) > -1 || String(it.note||"").toLowerCase().indexOf(q) > -1 || (qd.length >= 3 && String(it.phone||"").replace(/\D/g,"").indexOf(qd) > -1); });
  }
  $("#list-title").textContent = tab.title;
  var lm = sumBy(arr, tabSum(tab.id));
  $("#list-sub").textContent = arr.length+" ta · "+(tab.id === "closed" ? money(toUZS(lm), "UZS")+(lm.USD > 0 ? " (dollarlar "+rateText()+" kursida)" : "") : moneyLine(lm));
  var html;
  if(!state.items.length) html = '<div class="empty">'+ICON.book+'<p><b>Hali nasiya yozilmagan</b></p><p>Birinchi mijozni qo‘shing: ism, summa va to‘lash sanasi yetarli. Bo‘lib to‘lash ham mumkin.</p>'
    + (canWrite() ? '<div class="empty-actions"><button type="button" class="btn btn-primary" data-act="new">+ Nasiya qo‘shish</button><button type="button" class="btn btn-ghost" data-act="samples">Namunani ko‘rish</button></div>' : '')+'</div>';
  else if(!arr.length) html = '<div class="empty"><p>'+(q ? "Qidiruv bo‘yicha hech narsa topilmadi." : tab.empty)+'</p></div>';
  else html = arr.map(card).join("");
  setHTML($("#list"), html);
}
var lastBadge = -1;
function updateBadge(g){
  var n = g.today.length + g.late.length;
  if(n === lastBadge) return; lastBadge = n;
  try { if(navigator.setAppBadge){ if(n) navigator.setAppBadge(n).catch(noop); else navigator.clearAppBadge().catch(noop); } } catch(e){}
}

/* ---------- xabarlar ---------- */
var toastTimer;
function toast(msg, isErr){
  var t = $("#toast"); t.textContent = msg; t.hidden = false;
  t.className = "toast" + (isErr ? " err-toast" : ""); void t.offsetWidth; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.hidden = true; }, isErr ? 4200 : 2600);
}
function showErr(sel, msg){ var el = $(sel); el.textContent = msg || ""; el.hidden = !msg; }
function copyText(text, btn, label){
  var done = function(){ btn.textContent = "Nusxa olindi ✓"; setTimeout(function(){ btn.textContent = label; }, 1800); };
  try { navigator.clipboard.writeText(text).then(done, function(){ toast("Nusxalab bo‘lmadi. Matnni qo‘lda belgilang.", true); }); } catch(e){ toast("Nusxalab bo‘lmadi.", true); }
}

/* ---------- dialoglar ---------- */
function showDlg(d){ if(typeof d.showModal === "function"){ if(!d.open) d.showModal(); } else d.setAttribute("open", ""); }
function closeDlg(d){ if(!d) return; if(typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
Array.prototype.forEach.call(document.querySelectorAll("dialog"), function(d){ d.addEventListener("click", function(e){ if(e.target === d) closeDlg(d); }); });
function bindMoney(el){ el.addEventListener("input", function(){ var digits = el.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""); el.value = digits ? grp(Number(digits)) : ""; }); }
bindMoney($("#f-amount")); bindMoney($("#p-amount"));

/* qo'shish / tahrirlash */
var editing = null;
function disarmDel(){ var b = $("#f-del"); b.classList.remove("armed"); b.textContent = "O‘chirish"; clearTimeout(b._t); }
function setPlanUI(on){ $("#plan-box").hidden = !on; $("#due-box").hidden = on; if(on) planPreview(); }
function planParams(){
  return { total:parseMoney($("#f-amount").value), count:parseInt($("#f-count").value, 10), every:$("#f-every").value,
    first:$("#f-first").value, cur:$("#cur-usd").checked ? "USD" : "UZS" };
}
function planPreview(){
  var p = planParams(), el = $("#plan-preview");
  if(!(p.total > 0) || !(p.count >= 2 && p.count <= 60) || !isIso(p.first)){ el.innerHTML = '<span>Summa, necha marta (2–60) va birinchi to‘lov sanasini kiriting.</span>'; return; }
  var s = buildSchedule(p.total, p.count, p.every, p.first);
  var same = s.every(function(r){ return r.amount === s[0].amount; });
  el.innerHTML = '<b>'+p.count+' × '+esc(money(s[0].amount, p.cur))+(same ? "" : " (oxirgisi "+esc(money(s[s.length-1].amount, p.cur))+")")+'</b>'
    + '<span>'+esc(fmtDate(s[0].date, true))+' dan '+esc(fmtDate(s[s.length-1].date, true))+' gacha, '+(p.every === "week" ? "har hafta" : "har oy")+' '+(p.every === "week" ? WEEK[new Date(dayNum(p.first)*86400000).getUTCDay()] : Number(p.first.slice(8))+"-sanada")+'</span>';
}
["#f-amount","#f-count","#f-every","#f-first"].forEach(function(s){ $(s).addEventListener("input", planPreview); $(s).addEventListener("change", planPreview); });
$("#cur-usd").addEventListener("change", planPreview); $("#cur-uzs").addEventListener("change", planPreview);
$("#f-plan").addEventListener("change", function(){
  if(this.checked && !$("#f-first").value) $("#f-first").value = addMonths($("#f-given").value || state.today, 1);
  setPlanUI(this.checked);
});
function openForm(it){
  editing = it ? it.id : null;
  $("#f-title").textContent = it ? "Nasiyani tahrirlash" : "Yangi nasiya";
  $("#f-name").value = it ? (it.name || "") : "";
  $("#f-phone").value = it ? (it.phone || "") : "";
  $("#f-amount").value = it && amtOf(it) ? grp(amtOf(it)) : "";
  $("#cur-usd").checked = !!(it && it.currency === "USD"); $("#cur-uzs").checked = !(it && it.currency === "USD");
  $("#f-note").value = it ? (it.note || "") : "";
  $("#f-given").value = it && it.givenDate ? it.givenDate : state.today;
  $("#f-due").value = it && it.dueDate ? it.dueDate : "";
  var plan = !!(it && hasPlan(it) && it.plan);
  $("#f-plan").checked = plan;
  $("#f-count").value = plan ? it.plan.count : 6;
  $("#f-every").value = plan ? it.plan.every : "month";
  $("#f-first").value = plan ? it.plan.first : "";
  setPlanUI(plan);
  $("#f-del").hidden = !it; disarmDel(); showErr("#f-err", "");
  showDlg($("#dlg-form"));
  if(!it) setTimeout(function(){ $("#f-name").focus(); }, 60);
}
$("#due-chips").addEventListener("click", function(e){
  var b = e.target.closest("[data-plus]"); if(!b) return;
  var base = $("#f-given").value || state.today, v = b.dataset.plus, n = parseInt(v, 10);
  $("#f-due").value = v.slice(-1) === "m" ? addMonths(base, n) : addDays(base, n);
});
$("#form").addEventListener("submit", function(e){
  e.preventDefault();
  var d = { name:$("#f-name").value.trim(), phone:$("#f-phone").value.trim(), note:$("#f-note").value.trim(), amount:parseMoney($("#f-amount").value),
    currency:$("#cur-usd").checked ? "USD" : "UZS", givenDate:$("#f-given").value || state.today, dueDate:$("#f-due").value };
  var planOn = $("#f-plan").checked, pp = planParams();
  var miss = [];
  if(!d.name) miss.push("mijoz ismini");
  if(!(d.amount > 0)) miss.push("summani");
  if(!planOn && !d.dueDate) miss.push("to‘lash sanasini");
  if(planOn && !isIso(pp.first)) miss.push("birinchi to‘lov sanasini");
  if(miss.length) return showErr("#f-err", "Iltimos, "+miss.join(", ")+" kiriting.");
  if(planOn){
    if(!(pp.count >= 2 && pp.count <= 60)) return showErr("#f-err", "Necha marta: 2 dan 60 gacha.");
    if(dayNum(pp.first) < dayNum(d.givenDate)) return showErr("#f-err", "Birinchi to‘lov berilgan sanadan oldin bo‘lishi mumkin emas.");
    d.schedule = buildSchedule(d.amount, pp.count, pp.every, pp.first);
    d.plan = { count:pp.count, every:pp.every, first:pp.first };
    d.dueDate = d.schedule[d.schedule.length-1].date;
  } else {
    if(dayNum(d.dueDate) < dayNum(d.givenDate)) return showErr("#f-err", "To‘lash sanasi berilgan sanadan oldin bo‘lishi mumkin emas.");
    d.schedule = null; d.plan = null;
  }
  if(d.phone && !validPhone(d.phone)) return showErr("#f-err", "Telefon raqami to‘liq emas. Masalan: +998 90 123 45 67");
  var editId = editing;
  commit(function(){
    if(editId){
      state.items = state.items.map(function(x){
        if(x.id !== editId) return x;
        var y = Object.assign({}, x, d, {sample:false});
        var closed = paidOf(y) >= y.amount; y.closed = closed; y.closedAt = closed ? (x.closedAt || state.today) : null;
        return y;
      });
    } else {
      var item = Object.assign({ id:newId(), payments:[], closed:false, closedAt:null, createdAt:new Date().toISOString() }, d);
      state.items.push(item);
      state.tab = statusOf(item);
    }
  });
  closeDlg($("#dlg-form"));
  toast(editId ? "O‘zgarishlar saqlandi" : planOn ? "Nasiya qo‘shildi: "+pp.count+" ta to‘lov jadvali tuzildi" : "Nasiya qo‘shildi");
});
$("#f-del").addEventListener("click", function(){
  var b = $("#f-del");
  if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent = "Ha, o‘chirilsin"; clearTimeout(b._t); b._t = setTimeout(disarmDel, 4000); return; }
  disarmDel(); var id = editing;
  commit(function(){ state.items = state.items.filter(function(x){ return x.id !== id; }); });
  closeDlg($("#dlg-form")); toast("Nasiya o‘chirildi");
});

/* to'lov */
var paying = null;
function openPay(it){
  paying = it.id; var rem = remOf(it), cur = curOf(it), due = dueAmt(it);
  $("#p-who").innerHTML = '<b>'+esc(it.name)+'</b><span>'+(hasPlan(it) ? 'Hozirgi to‘lov: <span class="num">'+esc(money(due, cur))+'</span> · ' : '')+'Jami qoldiq: <span class="num">'+esc(money(rem, cur))+'</span></span>';
  $("#p-amount").value = hasPlan(it) && due > 0 ? grp(due) : "";
  $("#p-due").hidden = !(hasPlan(it) && due > 0 && due < rem);
  $("#p-due").textContent = "Bugungi to‘lov: "+money(due, cur); $("#p-due").dataset.v = String(due);
  $("#p-full").textContent = "To‘liq: "+money(rem, cur); $("#p-full").dataset.v = String(rem);
  $("#p-half").dataset.v = String(Math.round(rem/2)); $("#p-half").hidden = rem < 2 || hasPlan(it);
  $("#p-date").value = state.today; showErr("#p-err", ""); showDlg($("#dlg-pay"));
}
["#p-due","#p-full","#p-half"].forEach(function(s){ $(s).addEventListener("click", function(){ $("#p-amount").value = grp(Number(this.dataset.v)); }); });
$("#pay-form").addEventListener("submit", function(e){
  e.preventDefault();
  var it = find(paying); if(!it) return closeDlg($("#dlg-pay"));
  var amt = parseMoney($("#p-amount").value), rem = remOf(it), cur = curOf(it), date = $("#p-date").value || state.today;
  if(!(amt > 0)) return showErr("#p-err", "To‘lov summasini kiriting.");
  if(amt > rem) return showErr("#p-err", "To‘lov qoldiqdan ("+money(rem, cur)+") ko‘p bo‘lishi mumkin emas.");
  var closed = amt >= rem;
  commit(function(){
    state.items = state.items.map(function(x){
      if(x.id !== it.id) return x;
      var pays = (Array.isArray(x.payments) ? x.payments : []).slice(); pays.push({amount:amt, date:date});
      return Object.assign({}, x, {payments:pays, closed:closed, closedAt: closed ? date : null});
    });
  });
  closeDlg($("#dlg-pay"));
  var after = find(it.id), nx = planInfo(after).next;
  toast(closed ? "Nasiya to‘liq yopildi" : hasPlan(after) && nx ? "Qabul qilindi. Keyingi to‘lov: "+fmtDate(nx.date)+", "+money(nx.left, cur) : "To‘lov qabul qilindi: "+money(amt, cur));
});
function unpay(id, i){
  var key = id+":"+i;
  if(state.armedPay !== key){ state.armedPay = key; render(); setTimeout(function(){ if(state.armedPay === key){ state.armedPay = null; render(); } }, 4000); return; }
  state.armedPay = null;
  commit(function(){
    state.items = state.items.map(function(x){
      if(x.id !== id) return x;
      var pays = (x.payments || []).filter(function(_, j){ return j !== Number(i); });
      var y = Object.assign({}, x, {payments:pays}); var closed = paidOf(y) >= amtOf(y);
      y.closed = closed; y.closedAt = closed ? x.closedAt : null; return y;
    });
  });
  toast("To‘lov bekor qilindi");
}

/* ---------- bitta mijozga SMS ---------- */
var remId = null;
function openRemind(it){
  remId = it.id;
  var phone = intlPhone(it.phone);
  $("#rm-title").textContent = "SMS eslatma"; $("#rm-count").hidden = true;
  $("#rm-name").textContent = it.name; $("#rm-phone").textContent = prettyPhone(it.phone);
  $("#rm-nophone").hidden = !!phone; $("#rm-text").value = smsText(it);
  $("#rm-sms").hidden = !phone; $("#rm-sms").dataset.to = phone; updateSmsLink();
  $("#rm-next").hidden = true;
  $("#rm-sms").textContent = nativeSms() ? "Yuborish (SIM karta)" : "SMS yuborish";
  showDlg($("#dlg-rem"));
}
function smsHref(phone, text){ return "sms:"+phone+(/iphone|ipad|ipod|macintosh/i.test(navigator.userAgent) ? "&" : "?")+"body="+encodeURIComponent(text); }
function updateSmsLink(){ var s = $("#rm-sms"); s.setAttribute("href", smsHref(s.dataset.to || "", $("#rm-text").value)); }
$("#rm-text").addEventListener("input", updateSmsLink);
$("#rm-copy").addEventListener("click", function(){ copyText($("#rm-text").value, this, "Nusxalash"); });
$("#rm-sms").addEventListener("click", function(e){
  var n = nativeSms(), it = find(remId);
  if(!it) return;
  if(n){
    e.preventDefault();
    startNativeBatch([{ id:it.id, phone:intlPhone(it.phone), text:$("#rm-text").value }], function(){ closeDlg($("#dlg-rem")); });
    return;
  }
  markSent(it.id); setTimeout(render, 300);
});

/* ---------- bugungi SMS'lar: hammasiga ---------- */
function nativeSms(){ return window.NasiyaNative && typeof window.NasiyaNative.sendSms === "function" ? window.NasiyaNative : null; }
var bulk = { list:[], idx:0, running:false, results:{}, batch:null, onDone:null };
function renderBulk(){
  var n = nativeSms(), ts = todaysSms(), list = bulk.list;
  var cur = function(it){ return curOf(it); };
  var sums = entries(sumBy(list, function(it){ return dueAmt(it); }));
  $("#bk-sum").innerHTML = '<b>'+list.length+' kishi · '+esc(sums.map(function(x){ return money(x[1], x[0]); }).join(" + "))+'</b>'
    + '<span>'+(n ? "SMS telefoningiz SIM kartasidan ketadi (operator tarifingiz bo‘yicha)." : "Har bir SMS telefoningiz SMS ilovasida ochiladi.")+'</span>'
    + (ts.sent.length ? '<span>Bugun allaqachon yuborilgan: '+ts.sent.length+'</span>' : '')
    + (ts.noPhone.length ? '<span>Telefon raqami yo‘q: '+names(ts.noPhone)+'</span>' : '');
  $("#bk-list").innerHTML = list.map(function(it, i){
    var r = bulk.results[it.id], st = r === true ? '<span class="st ok">yuborildi</span>' : r ? '<span class="st bad">xato</span>' : (bulk.running && n) ? '<span class="st mut">navbatda</span>' : '<span class="st mut">'+esc(money(dueAmt(it), cur(it)))+'</span>';
    return '<li class="'+(!n && i === bulk.idx && bulk.running ? "cur" : "")+'"><span class="who-n">'+esc(it.name)+'</span>'+st+'<span class="ph">'+esc(prettyPhone(it.phone))+'</span><span></span>'
      + '<span class="msg">'+esc(smsText(it))+(r && r !== true ? ' — <b style="color:var(--late)">'+esc(r)+'</b>' : '')+'</span></li>';
  }).join("") || '<li><span class="info">Bugun SMS yuboriladigan mijoz yo‘q.</span></li>';
  var foot = $("#bk-foot"), done = list.filter(function(it){ return bulk.results[it.id] === true; }).length;
  var prog = $("#bk-prog");
  prog.hidden = !bulk.running && !done;
  prog.innerHTML = '<div class="bar"><i style="width:'+(list.length ? Math.round(done / list.length * 100) : 0)+'%"></i></div><span>Yuborildi: '+done+' / '+list.length+'</span>';
  if(n){
    var sims = [];
    try { sims = JSON.parse(n.getSims ? n.getSims() : "[]") || []; } catch(e){}
    $("#bk-sim-wrap").hidden = sims.length < 2;
    if(sims.length >= 2 && !$("#bk-sim").options.length) $("#bk-sim").innerHTML = sims.map(function(s){ return '<option value="'+esc(s.id)+'">'+esc(s.name || ("SIM "+s.slot))+'</option>'; }).join("");
    $("#bk-hint").textContent = "Birinchi marta telefon SMS ruxsatini so‘raydi. Ilova faqat yuboradi: xabarlaringiz, kontaktlaringiz va qo‘ng‘iroqlaringizni o‘qimaydi. SMS’lar orasida "+Math.round(CONFIG.smsDelayMs/1000)+" soniya pauza bo‘ladi, shunda operator ularni spam deb hisoblamaydi. Ilovani yopmang.";
    foot.innerHTML = bulk.running ? '<span class="hint">Yuborilmoqda…</span>'
      : done === list.length && list.length ? '<span class="spacer"></span><button type="button" class="btn btn-primary" data-close>Tayyor</button>'
      : '<span class="spacer"></span><button type="button" class="btn btn-ghost" data-close>Bekor qilish</button><button type="button" class="btn btn-primary" id="bk-go"'+(list.length ? "" : " disabled")+'>Hammasiga yuborish ('+(list.length - done)+')</button>';
  } else {
    $("#bk-sim-wrap").hidden = true;
    $("#bk-hint").innerHTML = "Brauzer va iPhone xavfsizlik sababli SMS’ni o‘zi yubora olmaydi: har biri uchun SMS ilovasida «Yuborish»ni bosasiz. "
      + (isAndroid() ? '<a href="android.html">Android ilovasida</a> bitta tugma bilan hammasiga ketadi.' : "Android ilovasida bitta tugma bilan hammasiga ketadi.");
    var it = list[bulk.idx];
    foot.innerHTML = !list.length ? '<span class="spacer"></span><button type="button" class="btn btn-primary" data-close>Yopish</button>'
      : bulk.idx >= list.length ? '<span class="spacer"></span><button type="button" class="btn btn-primary" data-close>Tayyor</button>'
      : '<span class="hint">'+(bulk.idx+1)+' / '+list.length+': '+esc(it.name)+'</span><span class="spacer"></span>'
        + '<button type="button" class="btn btn-ghost" id="bk-skip">O‘tkazish</button>'
        + '<a class="btn btn-primary" id="bk-open" href="'+esc(smsHref(intlPhone(it.phone), smsText(it)))+'">SMS ochish</a>';
  }
}
function openBulk(){
  var ts = todaysSms();
  bulk = { list:ts.pending.slice(), idx:0, running:false, results:{}, batch:null, onDone:null };
  $("#bk-sim").innerHTML = "";
  renderBulk(); showDlg($("#dlg-bulk"));
}
function startNativeBatch(messages, onDone){
  var n = nativeSms(); if(!n) return;
  var batch = "b"+Date.now().toString(36);
  bulk.batch = batch; bulk.running = true; bulk.onDone = onDone || null;
  var sim = $("#bk-sim").value || "";
  try { n.sendSms(JSON.stringify({ batch:batch, sim:sim, delayMs:CONFIG.smsDelayMs, messages:messages })); }
  catch(e){ bulk.running = false; toast("SMS yuborib bo‘lmadi: "+(e && e.message || e), true); }
  if($("#dlg-bulk").open) renderBulk();
}
/* Android ilovasi har bir SMS natijasini shu funksiyalar orqali qaytaradi. */
window.__nasiyaSmsResult = function(r){
  if(!r || r.batch !== bulk.batch) return;
  bulk.results[r.id] = r.ok ? true : (r.error || "yuborilmadi");
  if(r.ok) markSent(r.id);
  if($("#dlg-bulk").open) renderBulk();
};
window.__nasiyaSmsDone = function(r){
  if(!r || r.batch !== bulk.batch) return;
  bulk.running = false; render();
  var ok = Object.keys(bulk.results).filter(function(k){ return bulk.results[k] === true; }).length;
  var bad = Object.keys(bulk.results).length - ok;
  toast(bad ? "Yuborildi: "+ok+", xato: "+bad : "SMS yuborildi: "+ok+" ta", !!bad);
  if(bulk.onDone) bulk.onDone();
  if($("#dlg-bulk").open) renderBulk();
};
$("#dlg-bulk").addEventListener("click", function(e){
  if(e.target.closest("#bk-go")){
    var msgs = bulk.list.filter(function(it){ return bulk.results[it.id] !== true; }).map(function(it){ return { id:it.id, phone:intlPhone(it.phone), text:smsText(it) }; });
    startNativeBatch(msgs);
    return;
  }
  if(e.target.closest("#bk-skip")){ bulk.idx++; renderBulk(); return; }
  if(e.target.closest("#bk-open")){
    var it = bulk.list[bulk.idx];
    bulk.running = true; bulk.pendingMark = it.id;
    // SMS ilovasidan qaytilganda keyingisiga o'tiladi.
    setTimeout(function(){ if(document.visibilityState === "visible" && bulk.pendingMark === it.id){ /* ochilmagan bo'lishi mumkin — kutamiz */ } }, 1500);
  }
});
document.addEventListener("visibilitychange", function(){
  if(document.visibilityState !== "visible" || !bulk.pendingMark) return;
  var id = bulk.pendingMark; bulk.pendingMark = null;
  bulk.results[id] = true; markSent(id); bulk.idx++;
  render(); if($("#dlg-bulk").open) renderBulk();
});

/* ---------- SMS matnlari ---------- */
function exampleItem(){
  var t = state.today;
  return state.items.filter(function(i){ return smsKind(i); })[0] || { name:"Aziz", note:"balon", amount:300, currency:"USD", payments:[], dueDate:t, schedule:[{date:t, amount:50},{date:addMonths(t,1), amount:50}] };
}
function tplCounter(id){
  var c = smsCount(fillTpl($(id).value || "", { ism:"Abdulaziz", nima:"telefon", summa:"1 500 000 so'm", sana:"30-noyabr", biznes:meta.business || "" }));
  var el = $(id+"-c");
  el.textContent = "≈ "+c.len+" belgi · "+c.n+" ta SMS"+(c.uni ? " · kirill yoki ‘ ’ belgilar bor: 1 SMS = 70 belgi" : "");
  el.style.color = c.n > 1 || c.uni ? "var(--today)" : "";
}
function renderTplDlg(){
  var t = tpl();
  $("#tp-today").value = t.today; $("#tp-late").value = t.late; $("#tp-soon").value = t.soon;
  ["#tp-today","#tp-late","#tp-soon"].forEach(tplCounter); tplExample();
}
function tplExample(){
  var it = exampleItem(), p = planInfo(it), cur = curOf(it);
  $("#tp-example").textContent = fillTpl($("#tp-today").value, { ism:it.name, nima:it.note || "", summa:smsMoney(p.dueNow || (p.next ? p.next.left : amtOf(it)), cur), sana:fmtDate(p.next ? p.next.date : it.dueDate), biznes:meta.business || "" });
}
["#tp-today","#tp-late","#tp-soon"].forEach(function(id){ $(id).addEventListener("input", function(){ tplCounter(id); tplExample(); }); });
$("#tp-reset").addEventListener("click", function(){ meta.tpl = null; saveMeta(); renderTplDlg(); toast("Standart matnlar qaytarildi"); });
$("#tp-form").addEventListener("submit", function(e){
  e.preventDefault();
  meta.tpl = { today:$("#tp-today").value.trim() || DEFAULT_TPL.today, late:$("#tp-late").value.trim() || DEFAULT_TPL.late, soon:$("#tp-soon").value.trim() || DEFAULT_TPL.soon };
  saveMeta(); closeDlg($("#dlg-tpl")); render(); toast("SMS matnlari saqlandi");
});

/* ---------- obuna oynasi ---------- */
function renderSubDlg(){
  var s = sub(), price = '<span>Narx: <b class="num">'+grp(CONFIG.price)+' so‘m</b> / oy</span>', html;
  if(s.status === "trial") html = '<b>Bepul sinov</b><span>'+fmtDate(s.trialLast, true)+' gacha · '+s.daysLeft+' kun qoldi</span>'+price;
  else if(s.status === "active") html = '<b style="color:var(--ok)">Obuna faol</b><span>'+fmtDate(s.until, true)+' gacha · '+s.daysLeft+' kun qoldi</span>'+price;
  else html = '<b style="color:var(--late)">Obuna tugagan</b><span>'+fmtDate(s.until, true)+' da tugagan</span>'+price;
  $("#sb-status").innerHTML = html;
  $("#sb-device").textContent = meta.deviceId;
  $("#sb-pay").textContent = CONFIG.paymentText;
  var msg = "Assalomu alaykum! Nasiya daftari obunasi uchun.\nBiznes: "+(meta.business || "")+"\nQurilma kodi: "+meta.deviceId;
  $("#sb-tg").setAttribute("href", "https://t.me/"+CONFIG.telegram+"?text="+encodeURIComponent(msg));
  $("#sb-tg").textContent = "Telegram: @"+CONFIG.telegram;
  $("#act-code").value = ""; showErr("#act-err", "");
}
$("#sb-copy-device").addEventListener("click", function(){ copyText(meta.deviceId, this, "Nusxalash"); });
$("#act-go").addEventListener("click", function(){
  var b = this; b.disabled = true; showErr("#act-err", "");
  activate($("#act-code").value).then(function(p){
    b.disabled = false; render(); renderSubDlg();
    toast("Obuna faollashtirildi: "+fmtDate(p.u, true)+" gacha");
  }, function(err){ b.disabled = false; showErr("#act-err", err.message || "Kod noto‘g‘ri."); });
});

/* ---------- biznes ---------- */
function renderBizDlg(){
  $("#bz-name").value = meta.business || ""; $("#bz-phone").value = meta.phone || "";
  var manual = meta.usd && meta.usd.src === "manual";
  $("#bz-rate").value = manual ? String(meta.usd.rate) : "";
  $("#bz-rate").placeholder = "Markaziy bank: "+grp(manual ? CONFIG.usdRate : usdRate());
  showErr("#bz-err", "");
}
$("#bz-form").addEventListener("submit", function(e){
  e.preventDefault();
  var n = $("#bz-name").value.trim(), p = $("#bz-phone").value.trim();
  if(!n) return showErr("#bz-err", "Biznes nomini kiriting.");
  var rv = $("#bz-rate").value.trim(), rate = parseRate(rv);
  if(rv && !(rate >= 1000 && rate <= 100000)) return showErr("#bz-err", "Dollar kursini so‘mda yozing, masalan 12 050.");
  meta.business = n.slice(0, 80); meta.phone = p.slice(0, 40);
  if(rv) meta.usd = {rate:rate, date:state.today, src:"manual"};
  else if(meta.usd && meta.usd.src === "manual"){ delete meta.usd; refreshRate(); }
  saveMeta(); render(); closeDlg($("#dlg-biz")); toast("Saqlandi");
});

/* ---------- sozlamalar ---------- */
function renderMenu(){
  var s = sub();
  $("#m-sub-s").textContent = s.status === "trial" ? "Bepul sinov · "+s.daysLeft+" kun qoldi" : s.status === "active" ? "Faol · "+fmtDate(s.until)+" gacha" : "Tugagan · faollashtirish kerak";
  $("#m-biz-s").textContent = meta.business || "";
  $("#m-last").textContent = meta.lastBackup ? "Oxirgi zaxira: "+fmtDate(meta.lastBackup, true) : "Hali zaxira olinmagan";
  var hasS = state.items.some(function(i){ return i.sample; });
  $("#m-samples-t").textContent = hasS ? "Namunalarni o‘chirish" : "Namuna yozuvlarni ko‘rish";
  $("#m-samples-s").textContent = hasS ? "Faqat namuna yozuvlar o‘chadi" : "Ilova qanday ishlashini ko‘rsatadi";
  $("#imp-confirm").hidden = true; showErr("#imp-err", "");
}
var openers = { "dlg-sub":renderSubDlg, "dlg-biz":renderBizDlg, "dlg-tpl":renderTplDlg };
function openDialog(id){
  if(id === "dlg-bulk"){ Array.prototype.forEach.call(document.querySelectorAll("dialog[open]"), function(d){ closeDlg(d); }); openBulk(); return; }
  Array.prototype.forEach.call(document.querySelectorAll("dialog[open]"), function(d){ closeDlg(d); });
  if(openers[id]) openers[id]();
  showDlg(document.getElementById(id));
}
$("#menu-btn").addEventListener("click", function(){ renderMenu(); showDlg($("#dlg-menu")); });

/* zaxira */
function markBackup(){ meta.lastBackup = todayISO(); saveMeta(); renderMenu(); toast("Zaxira nusxa tayyor"); }
$("#m-export").addEventListener("click", function(){
  var json = JSON.stringify({ app:"nasiya-daftari", version:3, exportedAt:new Date().toISOString(), business:meta.business || "", tpl:meta.tpl || null, items:state.items }, null, 2);
  var name = "nasiya-zaxira-"+todayISO()+".json", file = null;
  try { file = new File([json], name, {type:"application/json"}); } catch(e){}
  var canShare = false;
  try { canShare = !!(file && navigator.canShare && navigator.share && navigator.canShare({files:[file]})); } catch(e){}
  if(window.NasiyaNative && typeof window.NasiyaNative.saveFile === "function"){
    try {
      var where = window.NasiyaNative.saveFile(name, json);
      if(where){ meta.lastBackup = todayISO(); saveMeta(); renderMenu(); toast("Saqlandi: "+where); }
      else toast("Saqlash uchun ruxsat bering va qayta bosing.", true);
      return;
    } catch(e){}
  }
  if(canShare){ navigator.share({files:[file], title:"Nasiya daftari zaxirasi"}).then(markBackup, function(err){ if(!err || err.name !== "AbortError") download(json, name); }); return; }
  download(json, name);
});
function download(json, name){
  var url = URL.createObjectURL(new Blob([json], {type:"application/json"}));
  var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 5000); markBackup();
}
function cleanSchedule(s, total){
  if(!Array.isArray(s) || s.length < 2 || s.length > 60) return null;
  var ok = s.every(function(r){ return r && isIso(r.date) && Number(r.amount) > 0; });
  if(!ok) return null;
  var sum = s.reduce(function(a, r){ return a + Number(r.amount); }, 0);
  if(Math.abs(sum - total) > 0.01) return null;
  return s.map(function(r){ return { date:r.date, amount:Number(r.amount) }; });
}
var pendingImport = null, importFromOnboard = false;
function startImport(fromOnboard){ importFromOnboard = !!fromOnboard; $("#imp-file").click(); }
$("#imp-file").addEventListener("change", function(){
  var f = this.files && this.files[0]; this.value = ""; if(!f) return;
  var r = new FileReader();
  r.onload = function(){
    var items, biz = "", t = null;
    try {
      var d = JSON.parse(String(r.result));
      items = Array.isArray(d) ? d : d && d.items; biz = d && d.business || ""; t = d && d.tpl || null;
      if(!Array.isArray(items)) throw 0;
      items = items.filter(function(x){ return x && typeof x === "object" && x.name && isIso(x.dueDate) && !x.sample; }).map(function(x){
        var amount = Number(x.amount) || 0, sch = cleanSchedule(x.schedule, amount);
        return { id:newId(), name:String(x.name).slice(0,120), phone:String(x.phone||"").slice(0,40), note:String(x.note||"").slice(0,300),
          amount:amount, currency:x.currency === "USD" ? "USD" : "UZS", givenDate:isIso(x.givenDate) ? x.givenDate : x.dueDate, dueDate:x.dueDate,
          schedule:sch, plan:sch && x.plan ? x.plan : null,
          payments:(Array.isArray(x.payments) ? x.payments : []).filter(function(p){ return p && Number(p.amount) > 0 && isIso(p.date); }).map(function(p){ return {amount:Number(p.amount), date:p.date}; }),
          closed:!!x.closed, closedAt:isIso(x.closedAt) ? x.closedAt : null, createdAt:x.createdAt || new Date().toISOString() };
      }).filter(function(x){ return x.amount > 0; });
      if(!items.length) throw 0;
    } catch(e){
      if(importFromOnboard) return showErr("#ob-err", "Bu fayl Nasiya daftari zaxirasi emas.");
      if(!$("#dlg-menu").open){ renderMenu(); showDlg($("#dlg-menu")); }
      return showErr("#imp-err", "Bu fayl Nasiya daftari zaxirasi emas. Boshqa faylni tanlang.");
    }
    if(importFromOnboard){
      meta.business = meta.business || biz || "Nasiya daftari"; if(t && !meta.tpl) meta.tpl = t; saveMeta();
      state.items = state.items.concat(items); saveItems(); showMain(); state.tab = pickTab(); render();
      toast("Tiklandi: "+items.length+" ta nasiya"); return;
    }
    pendingImport = items;
    if(!$("#dlg-menu").open){ renderMenu(); showDlg($("#dlg-menu")); }
    $("#imp-text").textContent = "Faylda "+items.length+" ta nasiya bor. Ular mavjud yozuvlaringizga qo‘shiladi (hech narsa o‘chmaydi).";
    $("#imp-confirm").hidden = false; showErr("#imp-err", "");
  };
  r.readAsText(f);
});
$("#imp-yes").addEventListener("click", function(){
  if(!pendingImport) return; var n = pendingImport.length;
  commit(function(){ state.items = state.items.concat(pendingImport); });
  pendingImport = null; $("#imp-confirm").hidden = true; closeDlg($("#dlg-menu")); state.tab = pickTab(); render();
  toast("Qo‘shildi: "+n+" ta nasiya");
});
$("#imp-no").addEventListener("click", function(){ pendingImport = null; $("#imp-confirm").hidden = true; });

/* namunalar */
function makeSamples(){
  var t = state.today;
  var S = function(o){ return Object.assign({ id:newId(), payments:[], closed:false, closedAt:null, createdAt:new Date().toISOString(), currency:"UZS", sample:true }, o); };
  var P = function(total, count, first){ var s = buildSchedule(total, count, "month", first); return { schedule:s, plan:{count:count, every:"month", first:first}, dueDate:s[s.length-1].date }; };
  return [
    S(Object.assign({name:"Aziz Karimov", phone:"+998 90 000 00 01", note:"telefon", amount:300, currency:"USD", givenDate:addMonths(t,-2), payments:[{amount:50, date:addMonths(t,-1)}]}, P(300, 6, addMonths(t,-1)))),
    S({name:"Dilnoza Rahimova", phone:"+998 93 000 00 02", note:"disk 2 dona", amount:650000, givenDate:addDays(t,-14), dueDate:t}),
    S(Object.assign({name:"Sherzod Toshmatov", phone:"+998 97 000 00 03", note:"balon", amount:2400000, givenDate:addDays(addMonths(t,-1),-12)}, P(2400000, 4, addDays(t,-12)))),
    S({name:"Bekzod Aliyev", phone:"+998 99 000 00 04", note:"qishki shina", amount:120, currency:"USD", givenDate:addDays(t,-25), dueDate:addDays(t,-7)}),
    S(Object.assign({name:"Malika Yusupova", phone:"+998 91 000 00 05", note:"muzlatkich", amount:4800000, givenDate:addDays(t,-5)}, P(4800000, 6, addDays(t,10)))),
    S({name:"Jasur Nematov", phone:"+998 95 000 00 06", note:"akkumulyator", amount:1150000, givenDate:addDays(t,-3), dueDate:addDays(t,28)}),
    S({name:"Nodira Saidova", phone:"+998 90 000 00 07", note:"moy almashtirish", amount:420000, givenDate:addDays(t,-44), dueDate:addDays(t,-15), payments:[{amount:420000, date:addDays(t,-17)}], closed:true, closedAt:addDays(t,-17)})
  ];
}
function addSamples(){ commit(function(){ state.items = state.items.concat(makeSamples()); }); state.tab = pickTab(); render(); toast("Namuna yozuvlar qo‘shildi"); }
function clearSamples(){ commit(function(){ state.items = state.items.filter(function(i){ return !i.sample; }); }); toast("Namunalar o‘chirildi"); }
$("#m-samples").addEventListener("click", function(){
  if(state.items.some(function(i){ return i.sample; })) clearSamples(); else if(canWrite()) addSamples();
  closeDlg($("#dlg-menu"));
});

/* ---------- o'rnatish taklifi ---------- */
var deferredPrompt = null;
function isStandalone(){ return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true || !!window.NasiyaNative; }
function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function isAndroid(){ return /android/i.test(navigator.userAgent) && !window.NasiyaNative; }
// Android ilovasining o'zida yuklab olish havolalari kerak emas.
if(window.NasiyaNative) Array.prototype.forEach.call(document.querySelectorAll(".js-android"), function(el){ el.hidden = true; });
function renderInstall(){
  var el = $("#install");
  if(window.NasiyaNative || $("#main").hidden){ el.hidden = true; return; }
  var x = '<button type="button" class="icon-btn" id="inst-x" aria-label="Yopish"><svg class="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
  if(isAndroid() && !meta.apkDismissed){
    el.dataset.kind = "apk";
    el.innerHTML = '<p><b>Android ilovasi.</b> SMS’lar bitta tugma bilan hammaga o‘z SIM kartangizdan ketadi. Faqat SMS yuborish ruxsati.</p><a class="btn btn-sm btn-primary" href="android.html">Yuklab olish</a>'+x;
    el.hidden = false; return;
  }
  el.dataset.kind = "pwa";
  if(isStandalone() || meta.installDismissed){ el.hidden = true; return; }
  if(deferredPrompt){ el.innerHTML = '<p><b>Ilovani o‘rnating.</b> Telefon ekranida alohida belgi bilan turadi va internetsiz ham ochiladi.</p><button type="button" class="btn btn-sm btn-primary" id="inst-go">O‘rnatish</button>'+x; el.hidden = false; }
  else if(isIOS()){ el.innerHTML = '<p><b>Ekranga qo‘shing.</b> Safari’da pastdagi «Ulashish» tugmasini, keyin «Ekranga qo‘shish» (Add to Home Screen) ni bosing.</p>'+x; el.hidden = false; }
  else el.hidden = true;
}
window.addEventListener("beforeinstallprompt", function(e){ e.preventDefault(); deferredPrompt = e; renderInstall(); });
window.addEventListener("appinstalled", function(){ deferredPrompt = null; renderInstall(); toast("Ilova o‘rnatildi"); });
$("#install").addEventListener("click", function(e){
  if(e.target.closest("#inst-x")){ if(this.dataset.kind === "apk") meta.apkDismissed = true; else meta.installDismissed = true; saveMeta(); renderInstall(); return; }
  if(e.target.closest("#inst-go") && deferredPrompt){ deferredPrompt.prompt(); deferredPrompt.userChoice.then(function(){ deferredPrompt = null; renderInstall(); }, noop); }
});

/* ---------- birinchi kirish ---------- */
function showMain(){ $("#onboard").hidden = true; $("#main").hidden = false; renderInstall(); }
$("#ob-form").addEventListener("submit", function(e){
  e.preventDefault();
  var n = $("#ob-name").value.trim();
  if(!n) return showErr("#ob-err", "Biznes nomini kiriting.");
  meta.business = n.slice(0, 80); meta.phone = $("#ob-phone").value.trim().slice(0, 40); saveMeta();
  showMain(); state.tab = pickTab(); render();
  toast("Xush kelibsiz! 30 kunlik bepul sinov boshlandi.");
});
$("#ob-restore").addEventListener("click", function(){ startImport(true); });

/* ---------- umumiy hodisalar ---------- */
document.addEventListener("click", function(e){
  var c = e.target.closest("[data-close]"); if(c){ closeDlg(c.closest("dialog")); return; }
  var op = e.target.closest("[data-open]"); if(op){ openDialog(op.dataset.open); return; }
  var tb = e.target.closest("[data-tab]");
  if(tb){ state.tab = tb.dataset.tab; render(); if(tb.dataset.jump) $("#list-head").scrollIntoView({behavior: reduceMotion ? "auto" : "smooth", block:"start"}); return; }
  if(e.target.closest("#clear-samples")){
    if(!state.armSamples){ state.armSamples = true; render(); setTimeout(function(){ if(state.armSamples){ state.armSamples = false; render(); } }, 4000); return; }
    state.armSamples = false; clearSamples(); return;
  }
  var act = e.target.closest("[data-act]"); if(!act) return;
  var kind = act.dataset.act;
  if(kind === "new"){ if(canWrite()) openForm(null); else openDialog("dlg-sub"); return; }
  if(kind === "import"){ if(canWrite()) startImport(false); else openDialog("dlg-sub"); return; }
  if(kind === "samples"){ addSamples(); return; }
  if(kind === "unpay"){ unpay(act.dataset.id, act.dataset.i); return; }
  var it = find(act.dataset.id); if(!it) return;
  if(!canWrite()) openDialog("dlg-sub");
  else if(kind === "remind") openRemind(it);
  else if(kind === "pay") openPay(it);
  else if(kind === "edit") openForm(it);
});
$("#list").addEventListener("toggle", function(e){
  var d = e.target;
  if(d && d.matches && d.matches("details[data-id]")){ if(d.open) state.openHist.add(d.dataset.id); else state.openHist.delete(d.dataset.id); }
}, true);
$("#q").addEventListener("input", function(){ state.q = this.value; renderList(compute()); });
function checkDay(){ var t = todayISO(); if(t !== state.today){ state.today = t; ensureMeta(); render(); refreshRate(); } }
setInterval(checkDay, 60000);
document.addEventListener("visibilitychange", function(){ if(document.visibilityState === "visible") checkDay(); });
window.addEventListener("storage", function(e){ if(e.key === DATA_KEY){ state.items = loadItems(); render(); } });

/* ---------- ishga tushirish ---------- */
try { localStorage.setItem("nd-test", "1"); localStorage.removeItem("nd-test"); }
catch(e){ state.storageOk = false; }
Array.prototype.forEach.call(document.querySelectorAll(".js-price"), function(el){ el.textContent = grp(CONFIG.price)+"\u00A0so‘m"; });
loadMeta(); ensureMeta();
state.items = loadItems();
state.tab = pickTab();
if(meta.business){ showMain(); render(); }
else { $("#onboard").hidden = false; }
refreshRate();
if(!state.storageOk){ $("#notice-text").textContent = "Bu brauzer ma’lumotlarni saqlashga ruxsat bermayapti (yashirin rejim bo‘lishi mumkin). Oddiy rejimda oching."; $("#notice").hidden = false; }
if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost") && !window.NasiyaNative){
  window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(noop); });
}
/* ---------- avtomatik yangilanish: saytga yangi versiya joylansa, ilova o'zi yangilanadi ---------- */
function checkUpdate(){
  if(window.NasiyaNative || !window.fetch) return;
  fetch("version.json?t="+Date.now(), {cache:"no-store"}).then(function(r){ return r.ok ? r.json() : null; }).then(function(j){
    if(!j || !j.v || j.v === APP_VERSION) return;
    var key = "nd-reloaded-"+j.v;
    try { if(sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch(e){}
    if(document.querySelector("dialog[open]")) return;
    location.reload();
  }).catch(noop);
}
setTimeout(checkUpdate, 1500);
document.addEventListener("visibilitychange", function(){ if(document.visibilityState === "visible") checkUpdate(); });

/* Android ilovasi uchun ilgaklar. */
window.NasiyaApp = { version: 3, refresh: function(){ render(); } };
window.__nasiyaPermissions = function(){ $("#bk-sim").innerHTML = ""; if($("#dlg-bulk").open) renderBulk(); };
window.__nasiyaBack = function(){
  var open = document.querySelectorAll("dialog[open]");
  if(open.length){ closeDlg(open[open.length-1]); return true; }
  return false;
};
})();
