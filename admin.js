/**
 * Password-protected admin for News and Case Studies.
 *
 * Auth: set ADMIN_PASSWORD. A signed-ish session cookie (random token held in
 * memory) is issued on login; tokens die on restart, which is fine for a
 * single-editor CMS.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const sanitizeHtml = require("sanitize-html");
const store = require("./db");

const router = express.Router();

// Every article body passes through here on save. The editor produces HTML,
// and legacy articles already stored HTML that renderBody() outputs verbatim —
// so this allowlist is the only thing standing between a pasted-from-Word mess
// (or worse) and the public site. Plain-text bodies pass through unchanged and
// still render via the paragraph builder in content.js.
function cleanBody(html) {
  const s = String(html || "");
  if (!s.trim()) return "";
  return sanitizeHtml(s, {
    allowedTags: ["p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s",
      "ul", "ol", "li", "a", "blockquote", "img", "figure", "figcaption", "iframe", "hr"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      iframe: ["src", "width", "height", "allowfullscreen", "frameborder"],
    },
    // Video embeds: YouTube/Vimeo only (legacy articles use them).
    allowedIframeHostnames: ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"],
    allowedSchemes: ["http", "https", "mailto", "tel"],
    // An iframe whose src failed the hostname check would survive as an empty
    // tag and render as a blank box — drop it outright.
    exclusiveFilter: (frame) => frame.tag === "iframe" && !(frame.attribs && frame.attribs.src),
    // Word/Google-Docs paste arrives as div soup — flatten it to paragraphs,
    // and make sure links opened in a new tab can't reach back to our window.
    transformTags: {
      div: "p",
      a: (tagName, attribs) => ({
        tagName: "a",
        attribs: attribs.target === "_blank" ? { ...attribs, rel: "noopener" } : attribs,
      }),
    },
  });
}

// Cache-bust the stylesheet (these pages render live, not via build.js).
let CSS_V = "";
try {
  CSS_V = crypto.createHash("md5").update(fs.readFileSync(path.join(__dirname, "public", "css", "style.css"))).digest("hex").slice(0, 10);
} catch { /* leave unversioned if unreadable */ }
const CSS_HREF = "/css/style.css" + (CSS_V ? "?v=" + CSS_V : "");
const sessions = new Set();
const COOKIE = "ds_admin";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} | Design &amp; Supply Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${CSS_HREF}">
<link rel="icon" href="/images/favicon.png">
</head><body>
<div class="admin-bar"><div class="container">
  <div><a href="/admin">Dashboard</a><a href="/admin/new/news">+ News</a><a href="/admin/new/case-study">+ Case Study</a></div>
  <div><a href="/" target="_blank" rel="noopener">View site</a><a href="/admin/logout">Log out</a></div>
</div></div>
<section class="section" style="padding:44px 0"><div class="container">${body}</div></section>
</body></html>`;
}

function isAuthed(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const token = req.cookies ? req.cookies[COOKIE] : null;
  return token && sessions.has(token);
}

// ---- login ----------------------------------------------------------------
router.get("/login", (req, res) => {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).send(
      page("Unavailable", `<h1>Admin not configured</h1><p style="color:var(--slate)">Set the <b>ADMIN_PASSWORD</b> environment variable to enable the admin.</p>`)
    );
  }
  const bad = req.query.bad ? `<p style="color:#b00">Incorrect password.</p>` : "";
  res.send(
    page(
      "Log in",
      `<div style="max-width:420px"><h1>Admin <em style="font-style:normal;color:var(--accent)">Login</em></h1>${bad}
      <form method="post" action="/admin/login" class="form" style="margin-top:20px">
        <div><label for="password">Password</label><input type="password" id="password" name="password" required autofocus></div>
        <div><button class="btn btn-primary" type="submit">Log in</button></div>
      </form></div>`
    )
  );
});

router.post("/login", (req, res) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (expected && req.body.password === expected) {
    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.protocol === "https",
      maxAge: 1000 * 60 * 60 * 12,
    });
    return res.redirect("/admin");
  }
  res.redirect("/admin/login?bad=1");
});

router.get("/logout", (req, res) => {
  const token = req.cookies ? req.cookies[COOKIE] : null;
  if (token) sessions.delete(token);
  res.clearCookie(COOKIE);
  res.redirect("/admin/login");
});

// ---- everything below requires auth ---------------------------------------
router.use((req, res, next) => {
  if (isAuthed(req)) return next();
  res.redirect("/admin/login");
});

// Image upload: the browser resizes to a data URL and POSTs it here; we save it
// to the volume and return its public /uploads/ path.
router.post("/upload", (req, res) => {
  try {
    res.json({ ok: true, url: store.saveUpload(req.body && req.body.dataUrl) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

const TYPE_LABEL = { news: "News", "case-study": "Case Study" };

function rows(type) {
  const posts = store.allOfType(type);
  if (!posts.length) return `<tr><td colspan="5" style="color:var(--slate)">Nothing here yet.</td></tr>`;
  return posts
    .map(
      (p) => `<tr>
      <td><b>${esc(p.title)}</b><br><span style="color:var(--slate);font-size:13px">/${type === "news" ? "news" : "case-studies"}/${esc(p.slug)}</span></td>
      <td>${esc(p.category || "—")}</td>
      <td>${esc(p.published_at || "—")}</td>
      <td><span class="pill ${p.is_published ? "pill-live" : "pill-draft"}">${p.is_published ? "Live" : "Draft"}</span></td>
      <td style="white-space:nowrap">
        <a href="/admin/edit/${p.id}">Edit</a>
        &nbsp;·&nbsp;
        <form method="post" action="/admin/delete/${p.id}" style="display:inline" onsubmit="return confirm('Delete this post permanently?')">
          <button type="submit" style="background:none;border:0;color:#b00;cursor:pointer;padding:0;font:inherit">Delete</button>
        </form>
      </td></tr>`
    )
    .join("");
}

router.get("/", (req, res) => {
  res.send(
    page(
      "Dashboard",
      `<h1>Content <em style="font-style:normal;color:var(--accent)">Admin</em></h1>
      <h2 style="margin:34px 0 12px">News</h2>
      <table class="admin-table"><tr><th>Title</th><th>Category</th><th>Date</th><th>Status</th><th></th></tr>${rows("news")}</table>
      <h2 style="margin:44px 0 12px">Case Studies</h2>
      <table class="admin-table"><tr><th>Title</th><th>Category</th><th>Date</th><th>Status</th><th></th></tr>${rows("case-study")}</table>`
    )
  );
});

function form(post, type) {
  const p = post || {};
  const action = post ? `/admin/edit/${post.id}` : `/admin/new/${type}`;
  const t = post ? post.type : type;
  return page(
    post ? "Edit" : "New",
    `<style>
    .img-upload .drop{border:2px dashed var(--line);border-radius:10px;padding:20px;text-align:center;color:var(--slate);cursor:pointer;background:#fafcfb;transition:border-color .15s,background .15s}
    .img-upload .drop.over{border-color:var(--accent);background:var(--accent-soft)}
    .img-preview{position:relative;display:inline-block;margin-bottom:10px}
    .img-preview img{max-width:280px;max-height:180px;border:1px solid var(--line);border-radius:8px;display:block}
    .img-preview button{position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;border:0;background:#b00;color:#fff;cursor:pointer;font-size:15px;line-height:1}
    .ed-bar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;border:1px solid var(--line);border-bottom:0;border-radius:8px 8px 0 0;background:var(--mist);padding:7px 9px}
    .ed-bar button{border:1px solid transparent;background:none;border-radius:6px;padding:5px 10px;font-size:13.5px;color:var(--ink);cursor:pointer;line-height:1.2}
    .ed-bar button:hover{background:#fff;border-color:var(--line)}
    .ed-bar button.on{background:#fff;border-color:var(--accent);color:var(--accent)}
    .ed-bar select{border:1px solid var(--line);border-radius:6px;padding:5px 8px;font-size:13.5px;background:#fff;color:var(--ink)}
    .ed-sep{width:1px;height:20px;background:var(--line);margin:0 4px}
    .ed-area{border:1px solid var(--line);border-radius:0 0 8px 8px;background:#fff;min-height:420px;padding:18px 20px;font-size:16px;line-height:1.65;color:var(--ink);outline:none;overflow-y:auto}
    .ed-area:focus{border-color:var(--accent)}
    .ed-area p{margin:0 0 14px;color:var(--slate)}
    .ed-area h2{font-size:24px;margin:22px 0 10px;color:var(--ink)}
    .ed-area h3{font-size:19px;margin:18px 0 8px;color:var(--ink)}
    .ed-area ul,.ed-area ol{padding-left:24px;margin:0 0 14px;color:var(--slate)}
    .ed-area ul{list-style:disc}.ed-area ol{list-style:decimal}
    .ed-area li{margin-bottom:6px}
    .ed-area blockquote{border-left:3px solid var(--accent);padding-left:16px;margin:16px 0;color:var(--ink)}
    .ed-area a{color:var(--accent);text-decoration:underline}
    .ed-area strong,.ed-area b{color:var(--ink)}
    .ed-area img{max-width:100%;height:auto;border-radius:8px}
    </style>
    <h1>${post ? "Edit" : "New"} <em style="font-style:normal;color:var(--accent)">${esc(TYPE_LABEL[t] || t)}</em></h1>
    <form method="post" action="${action}" class="form" style="margin-top:24px;max-width:900px">
      <div><label for="title">Title</label><input id="title" name="title" required value="${esc(p.title || "")}"></div>
      <div class="form-row">
        <div><label for="category">Category / tag</label><input id="category" name="category" value="${esc(p.category || "")}" placeholder="${t === "news" ? "Guides, Company News, Projects…" : "SR2 Security, Education…"}"></div>
        <div><label for="published_at">Date (YYYY-MM-DD)</label><input id="published_at" name="published_at" value="${esc(p.published_at || "")}" placeholder="2026-07-07"></div>
      </div>
      <div><label for="slug">URL slug (leave blank to auto-generate)</label><input id="slug" name="slug" value="${esc(p.slug || "")}"></div>
      <div><label>Image</label>
        <div class="img-upload">
          <div class="img-preview" id="imgPreview"${p.image ? "" : ' style="display:none"'}>${p.image ? `<img src="${esc(p.image)}" alt=""><button type="button" id="imgClear" title="Remove image">×</button>` : ""}</div>
          <div class="drop" id="imgDrop">Click or drop an image to upload<br><span style="color:var(--slate);font-size:12px">JPEG / PNG / WebP — resized automatically</span></div>
          <input type="file" id="imgFile" accept="image/*" hidden>
          <input type="text" id="image" name="image" value="${esc(p.image || "")}" placeholder="…or paste an image path / URL" style="margin-top:8px">
          <div id="imgMsg" style="font-size:13px;margin-top:6px"></div>
        </div>
      </div>
      <div><label for="excerpt">Excerpt (shown on the card)</label><textarea id="excerpt" name="excerpt" style="min-height:80px">${esc(p.excerpt || "")}</textarea></div>
      <div><label for="body">Body</label>
        <div id="edWrap" style="display:none">
          <div class="ed-bar" id="edBar">
            <select id="edStyle" title="Text style">
              <option value="p">Paragraph</option>
              <option value="h2">Heading</option>
              <option value="h3">Subheading</option>
              <option value="blockquote">Quote</option>
            </select>
            <span class="ed-sep"></span>
            <button type="button" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
            <button type="button" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
            <button type="button" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
            <span class="ed-sep"></span>
            <button type="button" data-cmd="insertUnorderedList" title="Bulleted list">&bull; List</button>
            <button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
            <span class="ed-sep"></span>
            <button type="button" id="edLink" title="Insert link">Link</button>
            <button type="button" id="edUnlink" title="Remove link">Unlink</button>
            <span class="ed-sep"></span>
            <button type="button" id="edClear" title="Clear formatting">Clear</button>
          </div>
          <div class="ed-area" id="edArea" contenteditable="true"></div>
        </div>
        <textarea id="body" name="body" style="min-height:420px" placeholder="Write your article here. Leave a blank line between paragraphs.">${esc(p.body || "")}</textarea>
        <small style="color:var(--slate);display:block;margin-top:6px">Format as you write — headings, bold, lists and links come through exactly as styled on the site. Pasting from Word is cleaned up automatically.</small></div>
      <label class="consent"><input type="checkbox" name="is_published" value="1" ${!post || p.is_published ? "checked" : ""}> Published (visible on the site)</label>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" type="submit">${post ? "Save changes" : "Create"}</button>
        <a class="btn btn-dark" href="/admin">Cancel</a>
        ${post ? `<a class="btn btn-dark" href="/${post.type === "news" ? "news" : "case-studies"}/${esc(post.slug)}" target="_blank" rel="noopener">Preview</a>` : ""}
      </div>
    </form>
    <script>
    (function(){
      function $(id){return document.getElementById(id);}
      var drop=$('imgDrop'),file=$('imgFile'),field=$('image'),prev=$('imgPreview'),msg=$('imgMsg');
      if(!drop) return;
      function bindClear(){var c=$('imgClear'); if(c) c.onclick=function(){field.value='';prev.style.display='none';prev.innerHTML='';};}
      function showPreview(url){field.value=url;prev.style.display='';prev.innerHTML='<img src="'+url+'" alt=""><button type="button" id="imgClear" title="Remove image">×</button>';bindClear();}
      function say(t,ok){msg.textContent=t;msg.style.color=ok?'var(--accent)':'#b00';}
      function handle(f){
        if(!f) return;
        if(!/^image\\//.test(f.type)){say('Please choose an image file.',false);return;}
        say('Uploading\\u2026',true);
        var img=new Image();
        img.onload=function(){
          var max=1600,s=Math.min(1,max/Math.max(img.width,img.height)),w=Math.round(img.width*s),h=Math.round(img.height*s);
          var c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(img,0,0,w,h);
          var data=c.toDataURL('image/jpeg',0.82);URL.revokeObjectURL(img.src);
          fetch('/admin/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataUrl:data})})
            .then(function(r){return r.json();})
            .then(function(j){if(!j.ok)throw new Error(j.error||'Upload failed');showPreview(j.url);say('Image uploaded.',true);})
            .catch(function(e){say(e.message,false);});
        };
        img.onerror=function(){say('Could not read that image.',false);};
        img.src=URL.createObjectURL(f);
      }
      drop.onclick=function(){file.click();};
      file.onchange=function(e){handle(e.target.files[0]);e.target.value='';};
      drop.addEventListener('dragover',function(e){e.preventDefault();drop.classList.add('over');});
      drop.addEventListener('dragleave',function(){drop.classList.remove('over');});
      drop.addEventListener('drop',function(e){e.preventDefault();drop.classList.remove('over');handle(e.dataTransfer.files[0]);});
      bindClear();
    })();
    </script>
    <script>
    (function(){
      function $(id){return document.getElementById(id);}
      var ta=$('body'),wrap=$('edWrap'),ed=$('edArea'),bar=$('edBar'),sel=$('edStyle');
      if(!ta||!wrap||!ed||!bar) return;
      function escText(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
      function plainToHtml(t){
        return t.replace(/\\r\\n/g,'\\n').split(/\\n{2,}/).map(function(p){return p.trim();}).filter(Boolean)
          .map(function(p){return '<p>'+escText(p).replace(/\\n/g,'<br>')+'</p>';}).join('');
      }
      var v=ta.value||'';
      var looksHtml=/<(p|h[1-6]|ul|ol|li|div|table|blockquote|br|img|a|strong|em|b|i|figure|iframe|span)[\\s>/]/i.test(v);
      ed.innerHTML=v.trim()?(looksHtml?v:plainToHtml(v)):'<p><br></p>';
      ta.style.display='none'; wrap.style.display='';
      try{document.execCommand('defaultParagraphSeparator',false,'p');}catch(e){}
      function sync(){ta.value=ed.innerHTML;}
      ed.addEventListener('input',sync);
      ta.form.addEventListener('submit',sync);
      bar.addEventListener('click',function(e){
        var b=e.target.closest('button[data-cmd]'); if(!b) return;
        ed.focus(); document.execCommand(b.getAttribute('data-cmd'),false,null); sync(); states();
      });
      sel.addEventListener('change',function(){ ed.focus(); document.execCommand('formatBlock',false,'<'+sel.value+'>'); sync(); });
      $('edLink').onclick=function(){
        ed.focus(); var u=prompt('Link address (https://\\u2026)'); if(!u) return;
        if(!/^(https?:|mailto:|tel:|\\/)/i.test(u)) u='https://'+u;
        document.execCommand('createLink',false,u); sync();
      };
      $('edUnlink').onclick=function(){ ed.focus(); document.execCommand('unlink',false,null); sync(); };
      $('edClear').onclick=function(){ ed.focus(); document.execCommand('removeFormat',false,null); document.execCommand('formatBlock',false,'<p>'); sync(); states(); };
      function states(){
        ['bold','italic','underline','insertUnorderedList','insertOrderedList'].forEach(function(c){
          var b=bar.querySelector('button[data-cmd="'+c+'"]'); if(!b) return;
          var on=false; try{on=document.queryCommandState(c);}catch(e){}
          b.classList.toggle('on',on);
        });
        var n=window.getSelection&&window.getSelection().anchorNode,blk='p';
        while(n&&n!==ed){ if(n.nodeType===1){var t=n.tagName.toLowerCase(); if(t==='h2'||t==='h3'||t==='blockquote'){blk=t;break;}} n=n.parentNode; }
        sel.value=blk;
      }
      document.addEventListener('selectionchange',function(){
        var s=document.getSelection();
        if(s&&s.anchorNode&&ed.contains(s.anchorNode)) states();
      });
      ed.addEventListener('paste',function(e){
        var cd=e.clipboardData; if(!cd) return;
        e.preventDefault();
        var html=cd.getData('text/html');
        if(html){
          var box=document.createElement('div'); box.innerHTML=html;
          ['script','style','meta','link','title'].forEach(function(t){
            Array.prototype.slice.call(box.querySelectorAll(t)).forEach(function(n){n.parentNode&&n.parentNode.removeChild(n);});
          });
          var ALLOW={P:1,BR:1,H2:1,H3:1,H4:1,STRONG:1,B:1,EM:1,I:1,U:1,S:1,UL:1,OL:1,LI:1,A:1,BLOCKQUOTE:1,IMG:1,FIGURE:1,FIGCAPTION:1,HR:1};
          var els=Array.prototype.slice.call(box.querySelectorAll('*'));
          for(var i=els.length-1;i>=0;i--){
            var el=els[i],tag=el.tagName;
            if(tag==='DIV'||tag==='SECTION'||tag==='ARTICLE'){
              var pEl=document.createElement('p');
              while(el.firstChild) pEl.appendChild(el.firstChild);
              el.parentNode.replaceChild(pEl,el); el=pEl; tag='P';
            } else if(!ALLOW[tag]){
              while(el.firstChild) el.parentNode.insertBefore(el.firstChild,el);
              el.parentNode.removeChild(el); continue;
            }
            for(var a=el.attributes.length-1;a>=0;a--){
              var nm=el.attributes[a].name;
              if(!((tag==='A'&&nm==='href')||(tag==='IMG'&&(nm==='src'||nm==='alt')))) el.removeAttribute(nm);
            }
          }
          document.execCommand('insertHTML',false,box.innerHTML);
        } else {
          document.execCommand('insertText',false,cd.getData('text/plain'));
        }
        sync();
      });
    })();
    </script>`
  );
}

router.get("/new/:type", (req, res) => {
  const type = req.params.type === "case-study" ? "case-study" : "news";
  res.send(form(null, type));
});

router.post("/new/:type", (req, res) => {
  const type = req.params.type === "case-study" ? "case-study" : "news";
  const b = req.body;
  const created = store.create({
    type,
    slug: b.slug || b.title,
    title: b.title,
    category: b.category,
    excerpt: b.excerpt,
    body: cleanBody(b.body),
    image: b.image,
    published_at: b.published_at,
    is_published: b.is_published ? 1 : 0,
  });
  res.redirect(created ? "/admin" : "/admin");
});

router.get("/edit/:id", (req, res) => {
  const post = store.getById(Number(req.params.id));
  if (!post) return res.redirect("/admin");
  res.send(form(post));
});

router.post("/edit/:id", (req, res) => {
  const b = req.body;
  store.update(Number(req.params.id), {
    slug: b.slug || b.title,
    title: b.title,
    category: b.category,
    excerpt: b.excerpt,
    body: cleanBody(b.body),
    image: b.image,
    published_at: b.published_at,
    is_published: b.is_published ? 1 : 0,
  });
  res.redirect("/admin");
});

router.post("/delete/:id", (req, res) => {
  store.remove(Number(req.params.id));
  res.redirect("/admin");
});

module.exports = router;
