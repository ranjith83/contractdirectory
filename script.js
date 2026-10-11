/* ===== SETUP: paste your Cloudflare Worker address between the quotes =====
   Example: "https://trades-book-api.yourname.workers.dev"
   Leave empty to try the page in preview mode (saves only in your own browser). */
const API_URL = "https://trades-book-api.mrk-ranjithkumar.workers.dev";

const $ = id => document.getElementById(id);
const esc = s => String(s||"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const FIELDS = ["name","trade","phone","email","notes"];
let contacts = [], editId = null, filter = "All";
const PAL=["#f5b82e","#7fd1ae","#8ec5fc","#f4a3a3","#c3a6f0","#ffcf99"];
const ICONS={plumber:"🔧",electrician:"⚡",tiler:"🧱",cleaner:"🧹",painter:"🎨",carpenter:"🪚",locksmith:"🔑","gas engineer":"🔥",roofer:"🏠","gut cleaner":"🧹",gardener:"🌿","pest control":"🐜"};
const col=t=>PAL[[...t.toLowerCase()].reduce((a,c)=>a+c.charCodeAt(0),0)%PAL.length];
const icon=t=>ICONS[t.toLowerCase()]||"🛠️";
const initials=n=>n.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("");

/* The phone number is the unique key of every contact: reviews and recommendations belong to it. */
const pkey = p => { let d=String(p||"").replace(/\D/g,""); if(d.startsWith("00")) d=d.slice(2); if(d.startsWith("353")&&d.length>9) d="0"+d.slice(3); return d; };

/* Device code kept in this browser. The server also checks the visitor's IP, so one person can recommend a contact only once. */
const DEV = (() => { try{ return localStorage.tb_dev || (localStorage.tb_dev = Math.random().toString(36).slice(2)+Date.now().toString(36)); }catch(e){ return Math.random().toString(36).slice(2)+Date.now().toString(36); } })();
let ACCESS = (() => { try{ return localStorage.tb_access || ""; }catch(e){ return ""; } })();   /* landlords' code, remembered */
let ADMIN = "";                                                                                 /* admin code, forgotten when the tab closes */

async function api(path, opt = {}, admin = false, tries = 0){
  const h = {"Content-Type":"application/json","X-Device":DEV};
  if(ACCESS) h["X-Access-Code"] = ACCESS;
  if(admin && ADMIN) h["X-Admin-Code"] = ADMIN;
  const r = await fetch(API_URL.trim().replace(/\/api\/contacts\/?$/,"").replace(/\/$/,"") + path, {...opt, headers:h});
  const j = await r.json().catch(() => ({}));
  if(r.status===401 && tries<2){
    if(j.need==="access"){ const c = prompt("Enter the landlords' access code:"); if(!c) throw new Error("Access code required"); ACCESS = c.trim(); try{ localStorage.tb_access = ACCESS; }catch(e){} return api(path,opt,admin,tries+1); }
    if(j.need==="admin"){ const c = prompt("Enter the admin code to edit or delete:"); if(!c) throw new Error("Admin code required"); ADMIN = c.trim(); return api(path,opt,admin,tries+1); }
  }
  if(!r.ok){
    if(r.status===401){ if(j.need==="access"){ ACCESS=""; try{ localStorage.removeItem("tb_access"); }catch(e){} } if(j.need==="admin") ADMIN=""; throw new Error("That code was not accepted. Please try again."); }
    const e = new Error(j.error || ("Error " + r.status)); e.status = r.status; throw e;
  }
  return j;
}

const store = API_URL ? {
  async list(){ return api("/api/contacts"); },
  async get(key){ try{ return await api("/api/contacts/"+key); }catch(e){ if(e.status===404) return null; throw e; } },
  async create(key, d){ await api("/api/contacts",{method:"POST",body:JSON.stringify(d)}); },
  async update(key, d){ await api("/api/contacts/"+key,{method:"PATCH",body:JSON.stringify(d)},true); },
  async remove(key){ await api("/api/contacts/"+key,{method:"DELETE"},true); },
  async recommend(id, v, d){ return (await api(`/api/contacts/${id}/recommend`,{method:"POST",body:JSON.stringify(d)})).status; },
  async review(id, d){ await api(`/api/contacts/${id}/review`,{method:"POST",body:JSON.stringify(d)}); }
} : {
  async _r(){ try{ return JSON.parse(localStorage.getItem("tb.preview2")) || []; }catch(e){ return []; } },
  async _w(l){ try{ localStorage.setItem("tb.preview2", JSON.stringify(l)); }catch(e){} },
  async list(){ return (await this._r()).map(c => ({...c, recCount:(c.recs||[]).length, voted:(c.recs||[]).some(r => r.dev===DEV)})); },
  async get(key){ return (await this._r()).find(c => c.id===key) || null; },
  async create(key, d){ const l = await this._r(); l.push({...d,id:key,recs:[],reviews:[]}); await this._w(l); },
  async update(key, d){ await this._w((await this._r()).map(c => c.id===key ? {...c,...d} : c)); },
  async remove(key){ await this._w((await this._r()).filter(c => c.id!==key)); },
  async recommend(id, v, d){
    const l = await this._r(), c = l.find(x => x.id===id); if(!c) return "ok";
    if((c.recs||[]).some(r => r.dev===DEV)) return "already";
    c.recs = [{dev:DEV,name:d.name,text:d.text,date:new Date().toISOString().slice(0,10),t:Date.now()}, ...(c.recs||[])];
    await this._w(l); return "ok";
  },
  async review(id, d){
    const l = await this._r(), c = l.find(x => x.id===id);
    if(c){ c.reviews = [{author:d.author,text:d.text,date:new Date().toISOString().slice(0,10),ts:Date.now()}, ...(c.reviews||[])]; await this._w(l); }
  }
};
let VOTER = null;
async function voterId(){ return { dev: DEV }; }
const hasVoted = c => !!c.voted;
const recList = c => c.recs || [];
const recCount = c => c.recCount || 0;
const revs = c => c.reviews || [];

async function refresh(){
  try{ contacts = await store.list(); $("notice").innerHTML = API_URL ? "" :
    '<div class="notice">Preview mode: contacts are saved only in this browser. To share the list with everyone, follow the setup steps and paste your Worker address into <code>API_URL</code> at the top of script.js.</div>'; }
  catch(e){ $("notice").innerHTML = '<div class="notice">Could not load the list (' + esc(e.message) + '). Check the API_URL, the access code and the Worker setup.</div>'; }
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
  }catch(e){ alert("Could not save: " + e.message); return; }
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
    try{ await store.remove(del); }catch(err){ alert("Could not delete: " + err.message); }
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
  let res; try{ res = await store.recommend(recId, await voterId(), {name, text:$("ctext").value.trim()}); }catch(e){ alert("Could not save your recommendation: " + e.message); return; }
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
  catch(e){ alert("Could not save the review: " + e.message); return; }
  $("rtext").value=""; await refresh(); renderReviews();
};
voterId().then(() => render());
refresh(); setInterval(()=>{ if(!document.hidden && !$("dlg").open && !$("rdlg").open && !$("cdlg").open) refresh(); }, 300000);