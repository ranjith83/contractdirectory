/* ===== SETUP: paste your Firebase Realtime Database URL between the quotes =====
   Example: "https://my-trades-book-default-rtdb.europe-west1.firebasedatabase.app"
   Leave empty to try the page in preview mode (saves only in your own browser). */
const DB_URL = "";

const $ = id => document.getElementById(id);
const esc = s => String(s||"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const FIELDS = ["name","trade","phone","email","notes"];
let contacts = [], editId = null, filter = "All";
const PAL=["#f5b82e","#7fd1ae","#8ec5fc","#f4a3a3","#c3a6f0","#ffcf99"];
const ICONS={plumber:"🔧",electrician:"⚡",tiler:"🧱",cleaner:"🧹",painter:"🎨",carpenter:"🪚",locksmith:"🔑","gas engineer":"🔥",roofer:"🏠",gardener:"🌿","pest control":"🐜"};
const col=t=>PAL[[...t.toLowerCase()].reduce((a,c)=>a+c.charCodeAt(0),0)%PAL.length];
const icon=t=>ICONS[t.toLowerCase()]||"🛠️";
const initials=n=>n.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("");

const BASE = DB_URL.replace(/\/$/,"") + "/contacts";
/* The phone number is the unique key of every contact: reviews and recommendations belong to it. */
const pkey = p => { let d=String(p||"").replace(/\D/g,""); if(d.startsWith("00")) d=d.slice(2); if(d.startsWith("353")&&d.length>9) d="0"+d.slice(3); return d; };
const store = DB_URL ? {
  async list(){
    const r = await fetch(BASE + ".json"); if(!r.ok) throw new Error(r.status);
    const o = await r.json() || {}; return Object.entries(o).map(([id,v]) => ({...v,id}));
  },
  async get(key){
    const r = await fetch(`${BASE}/${key}.json`); if(!r.ok) throw new Error(r.status);
    const v = await r.json(); return v ? {...v,id:key} : null;
  },
  async create(key, d){
    const r = await fetch(`${BASE}/${key}.json`,{method:"PUT",body:JSON.stringify(d)}); if(!r.ok) throw new Error(r.status);
  },
  async update(key, d){
    const r = await fetch(`${BASE}/${key}.json`,{method:"PATCH",body:JSON.stringify(d)}); if(!r.ok) throw new Error(r.status);
  },
  async remove(id){
    const r = await fetch(`${BASE}/${id}.json`,{method:"DELETE"}); if(!r.ok) throw new Error(r.status);
  },
  async recommend(id, v, d){
    const g = await fetch(`${BASE}/${id}/recBy.json`); if(!g.ok) throw new Error(g.status);
    if(hasVoted({recBy: await g.json() || {}}, v)) return "already";
    const r = await fetch(`${BASE}/${id}/recBy/${v.dev}.json`,{method:"PUT",body:JSON.stringify({ip:v.ip,t:Date.now(),name:d.name,text:d.text,date:new Date().toLocaleDateString()})});
    if(!r.ok) throw new Error(r.status);
    return "ok";
  },
  async review(id, d){
    const r = await fetch(`${BASE}/${id}/reviews.json`,{method:"POST",body:JSON.stringify(d)});
    if(!r.ok) throw new Error(r.status);
  }
} : {
  async list(){ try{ return JSON.parse(localStorage.getItem("tb.preview")) || []; }catch(e){ return []; } },
  async _w(l){ try{ localStorage.setItem("tb.preview", JSON.stringify(l)); }catch(e){} },
  async get(key){ return (await this.list()).find(c => c.id===key) || null; },
  async create(key, d){ const l = await this.list(); l.push({...d,id:key}); await this._w(l); },
  async update(key, d){ await this._w((await this.list()).map(c => c.id===key ? {...c,...d} : c)); },
  async remove(id){ await this._w((await this.list()).filter(c => c.id!==id)); },
  async recommend(id, v, d){
    const l = await this.list(), c = l.find(x => x.id===id);
    if(hasVoted(c, v)) return "already";
    await this._w(l.map(x => x.id===id ? {...x,recBy:{...(x.recBy||{}),[v.dev]:{ip:v.ip,t:Date.now(),name:d.name,text:d.text,date:new Date().toLocaleDateString()}}} : x));
    return "ok";
  },
  async review(id, d){ await this._w((await this.list()).map(c => c.id===id ? {...c,reviews:[...Object.values(c.reviews||{}),d]} : c)); }
};
let VOTER = null;
/* A voter is identified by BOTH a device code (kept in the browser) and a hashed IP. Matching either one counts as "already recommended". Raw IPs are never stored. */
async function sha(t){
  try{ const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tb:"+t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("").slice(0,24); }
  catch(e){ return [..."tb:"+t].reduce((a,c) => (a*31+c.charCodeAt(0))>>>0, 7).toString(36) + t.length; }
}
async function voterId(){
  if(VOTER) return VOTER;
  let dev; try{ dev = localStorage.tb_dev || (localStorage.tb_dev = Math.random().toString(36).slice(2)+Date.now().toString(36)); }catch(e){ dev = Math.random().toString(36).slice(2); }
  let ip = ""; try{ const r = await fetch("https://api.ipify.org?format=json"); ip = (await r.json()).ip || ""; }catch(e){}
  return VOTER = { dev: await sha("d"+dev), ip: ip ? await sha("i"+ip) : "" };
}
const hasVoted = (c, v) => !!v && Object.entries(c.recBy||{}).some(([k,x]) => k===v.dev || (v.ip && (k===v.ip || (x && x.ip===v.ip))));
const recList = c => Object.values(c.recBy||{}).filter(x => x && typeof x==="object" && (x.name||x.text)).sort((a,b)=>(b.t||0)-(a.t||0));
const recCount = c => Object.keys(c.recBy||{}).length + (c.rec||0);
const revs = c => Object.values(c.reviews||{}).sort((a,b)=>(b.ts||0)-(a.ts||0));
const mine = (k,id) => { try{ return (JSON.parse(localStorage.getItem(k))||[]).includes(id); }catch(e){ return false; } };
const markMine = (k,id) => { try{ const l=JSON.parse(localStorage.getItem(k))||[]; l.push(id); localStorage.setItem(k,JSON.stringify(l)); }catch(e){} };

async function refresh(){
  try{ contacts = await store.list(); $("notice").innerHTML = DB_URL ? "" :
    '<div class="notice">Preview mode: contacts are saved only in this browser. To share the list with everyone, follow the setup steps and paste your database URL into <code>DB_URL</code> at the top of the script.</div>'; }
  catch(e){ $("notice").innerHTML = '<div class="notice">Could not reach the shared database. Check the DB_URL and that the database rules allow reading and writing.</div>'; }
  render();
}

function render(){
  $("sC").textContent = contacts.length; $("sK").textContent = new Set(contacts.map(c=>c.trade)).size; $("sR").textContent = contacts.reduce((n,c)=>n+recCount(c),0);
  const cats = [...new Set(contacts.map(c => c.trade))].sort((a,b)=>a.localeCompare(b));
  if(filter!=="All" && !cats.includes(filter)) filter = "All";
  $("chips").innerHTML = ["All",...cats].map(t => `<button class="chip ${t===filter?"on":""}" data-t="${esc(t)}" aria-pressed="${t===filter}">${esc(t)}</button>`).join("");
  const q = $("q").value.toLowerCase();
  const shown = contacts.filter(c => (filter==="All"||c.trade===filter) && FIELDS.map(f=>c[f]||"").join(" ").toLowerCase().includes(q));
  if(!shown.length){ $("list").innerHTML = `<div class="empty">${contacts.length?"No contacts match your search.":"No contacts yet. Add the first plumber, tiler or cleaner."}</div>`; return; }
  const groups = {}; shown.forEach(c => (groups[c.trade] ||= []).push(c));
  $("list").innerHTML = Object.keys(groups).sort((a,b)=>a.localeCompare(b)).map(t => `
    <section><h2><span class="ico" style="--c:${col(t)}">${icon(t)}</span>${esc(t)} <small>${groups[t].length} ${groups[t].length===1?"contact":"contacts"}</small></h2><div class="list">
    ${groups[t].sort((a,b)=>recCount(b)-recCount(a)||a.name.localeCompare(b.name)).map(c => `
      <article class="card"><div class="top"><span class="av" style="--c:${col(t)}">${esc(initials(c.name))}</span><h3>${esc(c.name)}</h3></div>
        ${c.phone?`<a class="phone" href="tel:${esc(c.phone.replace(/[^+\d]/g,""))}">${esc(c.phone)}</a>`:""}
        ${c.email?`<p><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>`:""}
        ${c.notes?`<p>${esc(c.notes)}</p>`:""}
        <div class="rate">
          <button class="pill up ${hasVoted(c,VOTER)?"done":""}" data-rec="${esc(c.id)}">👍 Recommend · ${recCount(c)}</button>
          <button class="pill down" data-rev="${esc(c.id)}">👎 Negative reviews · ${revs(c).length}</button>
        </div>
        <div class="actions">
          ${c.phone?`<a class="call" href="tel:${esc(c.phone.replace(/[^+\d]/g,""))}">Call</a>`:""}
          <button class="ghost" data-edit="${esc(c.id)}">Edit</button>
          <button class="danger" data-del="${esc(c.id)}">Delete</button>
        </div></article>`).join("")}
    </div></section>`).join("");
}

function openForm(c){
  editId = c ? c.id : null;
  $("dtitle").textContent = c ? "Edit contact" : "Add contact";
  FIELDS.forEach(f => $(f).value = c ? (c[f]||"") : "");
  $("phone").readOnly = !!c;
  $("phint").textContent = c ? "The phone number can't be changed. To use a different number, add a new contact." : "";
  $("phint").style.color = c ? "var(--muted)" : "var(--danger)";
  $("dlg").showModal(); $("name").focus();
}
$("add").onclick = () => openForm();
$("heroAdd").onclick = () => openForm();
$("cancel").onclick = () => $("dlg").close();
$("phone").oninput = () => {
  if(editId) return;
  const ex = contacts.find(c => c.id===pkey($("phone").value));
  $("phint").textContent = ex ? `This number is already saved as "${ex.name}" (${ex.trade}).` : "";
};
$("form").onsubmit = async ev => {
  ev.preventDefault();
  const d = {}; FIELDS.forEach(f => d[f] = $(f).value.trim());
  try{
    if(editId){ await store.update(editId, d); }
    else{
      const key = pkey(d.phone);
      if(key.length < 7){ alert("Please enter a valid phone number."); return; }
      const ex = await store.get(key);
      if(ex){
        alert(`This phone number is already saved as "${ex.name}" (${ex.trade}).\n\nEach number can only be added once. You can recommend or review the existing contact instead.`);
        $("dlg").close(); filter = "All"; $("q").value = ex.phone || ""; refresh(); return;
      }
      await store.create(key, d);
    }
  }catch(e){ alert("Could not save. Check the database setup."); return; }
  $("dlg").close(); refresh();
};
$("q").oninput = render;
$("chips").onclick = e => { const t = e.target.dataset.t; if(t){ filter = t; render(); } };
$("list").onclick = async e => {
  const ed = e.target.dataset.edit, del = e.target.dataset.del, rec = e.target.dataset.rec, rv = e.target.dataset.rev;
  if(rec){ openRecs(rec); return; }
  if(rv){ openReviews(rv); return; }
  if(ed) openForm(contacts.find(c => c.id===ed));
  if(del && confirm("Delete this contact for everyone?")){
    try{ await store.remove(del); }catch(err){ alert("Could not delete."); }
    refresh();
  }
};
let recId=null;
function renderRecs(){
  const c = contacts.find(x => x.id===recId); if(!c) return;
  $("ctitle").textContent = "Recommendations: " + c.name;
  const l = recList(c), voted = hasVoted(c, VOTER);
  $("clist").innerHTML = l.length ? l.map(r => `<div class="rev good">${r.text ? esc(r.text) : "<em>Recommended without a comment.</em>"}<small>${esc(r.name||"Anonymous")} · ${esc(r.date||"")}</small></div>`).join("") : '<p class="empty" style="padding:16px">No recommendations with comments yet. Be the first.</p>';
  $("cform").hidden = voted; $("csend").hidden = voted; $("cdone").hidden = !voted;
}
async function openRecs(id){ recId=id; await voterId(); $("cname").value=""; $("ctext").value=""; renderRecs(); $("cdlg").showModal(); }
$("cclose").onclick = () => $("cdlg").close();
$("csend").onclick = async () => {
  const name = $("cname").value.trim(); if(!name){ $("cname").focus(); return; }
  let res; try{ res = await store.recommend(recId, await voterId(), {name, text:$("ctext").value.trim()}); }catch(e){ alert("Could not save your recommendation."); return; }
  if(res==="already") alert("You have already recommended this contact (from this device or internet connection).");
  await refresh(); renderRecs();
};
let revId=null;
function renderReviews(){
  const c = contacts.find(x => x.id===revId); if(!c) return;
  $("rtitle").textContent = "Negative reviews: " + c.name;
  const l = revs(c);
  $("rlist").innerHTML = l.length ? l.map(r => `<div class="rev">${esc(r.text)}<small>${esc(r.author||"Anonymous")} · ${esc(r.date||"")}</small></div>`).join("") : '<p class="empty" style="padding:16px">No negative reviews yet.</p>';
}
function openReviews(id){ revId=id; $("rtext").value=""; renderReviews(); $("rdlg").showModal(); }
$("rclose").onclick = () => $("rdlg").close();
$("rsend").onclick = async () => {
  const text = $("rtext").value.trim(); if(!text){ $("rtext").focus(); return; }
  try{ await store.review(revId,{text,author:$("rauthor").value.trim(),date:new Date().toLocaleDateString(),ts:Date.now()}); }
  catch(e){ alert("Could not save the review."); return; }
  $("rtext").value=""; await refresh(); renderReviews();
};
voterId().then(() => render());
refresh(); setInterval(()=>{ if(!$("dlg").open && !$("rdlg").open && !$("cdlg").open) refresh(); }, 30000);
