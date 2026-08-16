/**
 * Printable name badges, straight from the registration list.
 *
 * A4, four badges per sheet at 70x105 mm portrait - the paper size that fits
 * the lanyard pouches we ordered. Three columns would need exactly 210 mm and
 * leave nothing for the printer's unprintable edge, so two by two it is, with
 * room for scissors between them.
 *
 * Multi-seat registrations get one badge per seat: the extra ones carry the
 * company only, because we never asked for the colleagues' names.
 */

const PER_SHEET = 4;

function mount(app, deps) {
  const { guard, readAll, paidSet } = deps;

  app.get('/admin/badges', (req, res) => {
    if (!guard(req, res)) return;
    const k = encodeURIComponent(req.query.key);
    const onlyPaid = String(req.query.paid || '') === '1';
    const paid = paidSet();

    const badges = [];
    readAll().forEach((r) => {
      if (onlyPaid && paid.get(r.email) !== true) return;
      const seats = Math.max(1, parseInt(r.guests, 10) || 1);
      badges.push({ name: r.name, company: r.company || '', guest: false });
      for (let i = 1; i < seats; i++) {
        badges.push({ name: 'Guest', company: r.company || r.name, guest: true });
      }
    });

    res.setHeader('Cache-Control', 'no-store');
    res.send(page(k, badges, onlyPaid));
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Long names have to shrink rather than overflow the badge
function nameSize(n) {
  const len = String(n).length;
  if (len > 26) return '20px';
  if (len > 20) return '24px';
  if (len > 15) return '28px';
  return '32px';
}

function page(k, badges, onlyPaid) {
  const sheets = Math.ceil(badges.length / PER_SHEET) || 1;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Name badges (${badges.length})</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:#F7F4EE;color:#111}
.toolbar{padding:18px;max-width:900px;margin:0 auto}
.toolbar h1{font-size:19px}
.toolbar p{color:#555;font-size:14px;margin-top:6px;line-height:1.5}
.acts{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.acts a,.acts button{padding:11px 16px;border-radius:9px;font:inherit;font-size:14px;font-weight:600;
  text-decoration:none;border:1px solid #ddd;background:#fff;color:#333;cursor:pointer}
.acts .print{background:#111;color:#fff;border-color:#111}
.sheet{background:#fff;width:210mm;min-height:297mm;margin:18px auto;padding:16mm 14mm;
  display:grid;grid-template-columns:70mm 70mm;grid-auto-rows:105mm;gap:12mm 10mm;
  justify-content:center;align-content:start;box-shadow:0 4px 20px rgba(0,0,0,.08)}
.badge{border:1px dashed #ccc;padding:9mm 6mm;display:flex;flex-direction:column;
  align-items:center;text-align:center;overflow:hidden;page-break-inside:avoid}
.badge .logo{height:9mm}
.badge .nm{font-family:'Archivo Black',sans-serif;line-height:1.12;word-break:break-word;
  margin-top:auto}
.badge .co{font-size:13px;color:#555;margin-top:3mm;line-height:1.3;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.badge .rule{width:16mm;height:1mm;background:#F6BB12;margin:5mm 0 auto 0}
.badge .ev{font-size:8px;letter-spacing:.8px;color:#C9A24B;font-weight:700;line-height:1.4}
.empty{background:#fff;border:1px dashed #d8d2c4;border-radius:14px;padding:40px;text-align:center;color:#666;
  max-width:900px;margin:18px auto}
@media print{
  @page{size:A4;margin:0}
  body{background:#fff}
  .toolbar{display:none}
  .sheet{box-shadow:none;margin:0;width:auto;min-height:auto;page-break-after:always}
  .badge{border-color:#e5e5e5}
}
</style></head><body>

<div class="toolbar">
  <h1>Name badges: ${badges.length} &middot; ${sheets} sheet${sheets > 1 ? 's' : ''}</h1>
  <p>A4, four per sheet at 70&times;105&nbsp;mm portrait \u2014 the paper size for our lanyard pouches.
     Print at <b>100% scale</b> with margins set to none, then cut along the dashed lines.
     Registrations with several seats get one badge per seat.</p>
  <div class="acts">
    <button class="print" onclick="window.print()">Print</button>
    <a href="/admin/badges?key=${k}${onlyPaid ? '' : '&paid=1'}">${onlyPaid ? 'Include unpaid' : 'Paid only'}</a>
    <a href="/admin?key=${k}">&larr; Back to registrations</a>
  </div>
</div>

${badges.length
    ? Array.from({ length: sheets }, (_, i) => `<div class="sheet">${
      badges.slice(i * PER_SHEET, (i + 1) * PER_SHEET).map((b) => `
      <div class="badge">
        <img class="logo" src="/img/elev8.jpg" alt="">
        <div class="nm" style="font-size:${nameSize(b.name)}">${esc(b.name)}</div>
        <div class="co">${esc(b.company)}</div>
        <div class="rule"></div>
        <div class="ev">SMARTER REVENUE, BETTER TECH<br>28 AUGUST 2026 &middot; OXO THE FACTORY</div>
      </div>`).join('')}</div>`).join('')
    : '<div class="empty">No registrations to print yet.</div>'}

</body></html>`;
}

module.exports = { mount };
