#!/usr/bin/env python3
"""
Generate asset preview page output/index.html

Usage:
    python3 generate_gallery.py --project-dir "path/to/project"
    python3 generate_gallery.py  # falls back to PROJECT_DIR env var or cwd
"""
import json
import argparse
import os
from pathlib import Path


def load_json(path):
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return list(data.values())
    return []


def rel(path_str, output_dir: Path):
    """Convert absolute or output/-prefixed path to relative from output_dir."""
    if not path_str:
        return ""
    p = path_str.replace("\\", "/")
    # Strip leading output_dir prefix so browser can resolve relative to index.html
    output_prefix = str(output_dir).replace("\\", "/").rstrip("/") + "/"
    if p.startswith(output_prefix):
        p = p[len(output_prefix):]
        return p
    # Legacy: strip literal "output/" prefix
    if p.startswith("output/"):
        p = p[len("output/"):]
    return p


def generate(project_dir: Path):
    output_dir = project_dir

    actors_json    = output_dir / "actors" / "actors.json"
    locations_json = output_dir / "locations" / "locations.json"
    props_json     = output_dir / "props" / "props.json"
    out_html       = output_dir / "index.html"

    actors    = load_json(actors_json)
    locations = load_json(locations_json)
    props     = load_json(props_json)

    actors_js    = json.dumps(actors,    ensure_ascii=False)
    locations_js = json.dumps(locations, ensure_ascii=False)
    props_js     = json.dumps(props,     ensure_ascii=False)

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>资产预览</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0d0f18;color:#e2e8f0;min-height:100vh}}

/* Header */
.header{{background:#12152a;border-bottom:1px solid #1e2240;padding:16px 24px;position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:16px;flex-wrap:wrap}}
.header h1{{font-size:18px;font-weight:600;color:#a78bfa}}
.stats{{font-size:13px;color:#475569;margin-left:auto}}

/* Tabs */
.tabs{{display:flex;gap:2px;padding:16px 24px 0;background:#12152a;border-bottom:1px solid #1e2240}}
.tab{{padding:10px 20px;font-size:14px;font-weight:500;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}}
.tab:hover{{color:#a78bfa}}
.tab.active{{color:#a78bfa;border-bottom-color:#a78bfa}}

/* Panels */
.panel{{display:none;padding:24px}}
.panel.active{{display:block}}

/* Grid */
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}}

/* Card */
.card{{background:#1a1d2e;border:1px solid #2d3148;border-radius:12px;overflow:hidden;transition:border-color .15s;cursor:pointer}}
.card:hover{{border-color:#a78bfa}}
.card-img{{width:100%;aspect-ratio:1;object-fit:cover;background:#0d0f18;display:block}}
.card-img.wide{{aspect-ratio:16/9}}
.card-body{{padding:12px}}
.card-name{{font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:6px}}
.card-meta{{font-size:12px;color:#475569}}
.thumbs{{display:flex;gap:4px;margin-top:8px}}
.thumb{{width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #2d3148;cursor:pointer;transition:border-color .15s}}
.thumb:hover,.thumb.active{{border-color:#a78bfa}}
.badge{{display:inline-block;background:#1e293b;border:1px solid #334155;border-radius:4px;padding:2px 6px;font-size:11px;color:#7c93b0;margin-right:4px;margin-top:4px}}

/* Audio */
audio{{width:100%;margin-top:8px;height:28px}}

/* Modal */
.modal{{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;align-items:center;justify-content:center}}
.modal.open{{display:flex}}
.modal-content{{position:relative;max-width:90vw;max-height:90vh}}
.modal-img{{max-width:90vw;max-height:85vh;object-fit:contain;border-radius:8px}}
.modal-close{{position:absolute;top:-12px;right:-12px;background:#a78bfa;color:#fff;border:none;border-radius:50%;width:28px;height:28px;font-size:16px;cursor:pointer;line-height:28px;text-align:center}}

.empty{{text-align:center;color:#475569;padding:60px;font-size:15px}}
</style>
</head>
<body>

<div class="header">
  <h1>🎬 资产预览</h1>
  <div class="stats" id="stats"></div>
</div>

<div class="tabs">
  <div class="tab active" onclick="switchTab('actors',this)">角色</div>
  <div class="tab" onclick="switchTab('locations',this)">场景</div>
  <div class="tab" onclick="switchTab('props',this)">道具</div>
</div>

<div id="panel-actors"  class="panel active"></div>
<div id="panel-locations" class="panel"></div>
<div id="panel-props"   class="panel"></div>

<div class="modal" id="modal" onclick="closeModal()">
  <div class="modal-content" onclick="event.stopPropagation()">
    <button class="modal-close" onclick="closeModal()">✕</button>
    <img class="modal-img" id="modal-img" src="" alt="">
  </div>
</div>

<script>
const ACTORS    = {actors_js};
const LOCATIONS = {locations_js};
const PROPS     = {props_js};

function rel(p) {{
  if (!p) return '';
  return p.replace(/\\\\/g,'/').replace(/^output\\//, '');
}}

function img(src, cls, onclick) {{
  const s = rel(src);
  if (!s) return '';
  return `<img class="${{cls}}" src="${{s}}" alt="" loading="lazy" onerror="this.style.opacity=0.2"${{onclick ? ` onclick="${{onclick}}"` : ''}}>`;
}}

/* ── Actors ─────────────────────────────── */
function renderActors() {{
  const el = document.getElementById('panel-actors');
  if (!ACTORS.length) {{ el.innerHTML='<div class="empty">暂无角色</div>'; return; }}
  const cards = ACTORS.map(a => {{
    const d = a.default || {{}};
    const three = rel(d.three_view);
    const face  = rel(d.face_view);
    const side  = rel(d.side_view);
    const back  = rel(d.back_view);
    const voice = rel(a.voice || d.voice || '');
    const thumbs = [
      {{src: face,  label:'正面'}},
      {{src: side,  label:'侧面'}},
      {{src: back,  label:'背面'}},
    ].filter(t => t.src);
    return `<div class="card">
      <img class="card-img" id="main-${{a.name}}" src="${{three || face}}" alt="${{a.name}}" loading="lazy"
           onerror="this.style.opacity=0.2" onclick="openModal(this.src)">
      <div class="card-body">
        <div class="card-name">${{a.name}}</div>
        ${{d.subject_id ? `<span class="badge">✓ 已上传</span>` : '<span class="badge">未上传</span>'}}
        <div class="thumbs">
          ${{thumbs.map(t => `<img class="thumb" src="${{t.src}}" title="${{t.label}}" loading="lazy"
              onerror="this.style.opacity=0.2"
              onclick="swapMain('main-${{a.name}}','${{t.src}}',this)">`).join('')}}
        </div>
        ${{voice ? `<audio controls src="${{voice}}"></audio>` : ''}}
      </div>
    </div>`;
  }}).join('');
  el.innerHTML = `<div class="grid">${{cards}}</div>`;
}}

/* ── Locations ─────────────────────────── */
function renderLocations() {{
  const el = document.getElementById('panel-locations');
  if (!LOCATIONS.length) {{ el.innerHTML='<div class="empty">暂无场景</div>'; return; }}
  const cards = LOCATIONS.map(l => {{
    const main  = rel(l.main  || l.image || '');
    const close = rel(l.close || l.close_up || '');
    return `<div class="card">
      <img class="card-img wide" id="main-loc-${{l.name}}" src="${{main}}" alt="${{l.name}}" loading="lazy"
           onerror="this.style.opacity=0.2" onclick="openModal(this.src)">
      <div class="card-body">
        <div class="card-name">${{l.name}}</div>
        ${{l.subject_id ? `<span class="badge">✓ 已上传</span>` : '<span class="badge">未上传</span>'}}
        ${{close ? `<div class="thumbs"><img class="thumb" src="${{close}}" title="特写" loading="lazy"
            onclick="swapMain('main-loc-${{l.name}}','${{close}}',this)" onerror="this.style.opacity=0.2"></div>` : ''}}
      </div>
    </div>`;
  }}).join('');
  el.innerHTML = `<div class="grid">${{cards}}</div>`;
}}

/* ── Props ─────────────────────────────── */
function renderProps() {{
  const el = document.getElementById('panel-props');
  if (!PROPS.length) {{ el.innerHTML='<div class="empty">暂无道具</div>'; return; }}
  const cards = PROPS.map(p => {{
    const main = rel(p.main || p.image || '');
    return `<div class="card">
      <img class="card-img" src="${{main}}" alt="${{p.name}}" loading="lazy"
           onerror="this.style.opacity=0.2" onclick="openModal(this.src)">
      <div class="card-body">
        <div class="card-name">${{p.name}}</div>
        ${{p.subject_id ? `<span class="badge">✓ 已上传</span>` : '<span class="badge">未上传</span>'}}
      </div>
    </div>`;
  }}).join('');
  el.innerHTML = `<div class="grid">${{cards}}</div>`;
}}

function swapMain(id, src, thumb) {{
  document.getElementById(id).src = src;
  thumb.closest('.card').querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
  thumb.classList.add('active');
}}

function openModal(src) {{
  document.getElementById('modal-img').src = src;
  document.getElementById('modal').classList.add('open');
}}
function closeModal() {{ document.getElementById('modal').classList.remove('open'); }}
document.addEventListener('keydown', e => {{ if(e.key==='Escape') closeModal(); }});

function switchTab(name, btn) {{
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-'+name).classList.add('active');
}}

// Stats
document.getElementById('stats').textContent =
  `角色 ${{ACTORS.length}} · 场景 ${{LOCATIONS.length}} · 道具 ${{PROPS.length}}`;

renderActors();
renderLocations();
renderProps();
</script>
</body>
</html>"""

    out_html.write_text(html, encoding="utf-8")
    print(f"Generated {out_html}")
    print(f"  角色 {len(actors)} · 场景 {len(locations)} · 道具 {len(props)}")


if __name__ == "__main__":
    import sys as _sys

    if "--skill-invoked" not in _sys.argv:
        print("Error: this script must be invoked via the asset-gen skill.", file=_sys.stderr)
        _sys.exit(1)

    parser = argparse.ArgumentParser(description="Generate asset preview index.html")
    parser.add_argument(
        "--project-dir",
        default=os.environ.get("PROJECT_DIR", str(Path.cwd())),
        help="Project output directory (default: PROJECT_DIR env var or cwd)",
    )
    args = parser.parse_args()

    generate(Path(args.project_dir))
