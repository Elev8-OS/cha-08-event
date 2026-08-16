/**
 * Public slides page, linked from the follow-up emails (A7 / B3).
 *
 * The link goes out before the decks exist, so the page has to be live from
 * day one and simply say "not yet" for anything without a file. To publish a
 * deck, drop a PDF into public/decks/ and put its filename in the session
 * below - no other change needed.
 */

const SESSIONS = [
  {
    title: 'Revenue management',
    speaker: 'Andika Praba \u00b7 Elev8 Suite',
    blurb: 'Pricing, OTA mix and the levers that move RevPAR on a Bali property.',
    file: '',
  },
  {
    title: 'Finance & reporting',
    speaker: 'Intan Puspita Dewi \u00b7 Elevate Villas Bali, with Mekari Jurnal',
    blurb: 'Compliant bookkeeping and owner reporting in a real operation.',
    file: '',
  },
  {
    title: 'Guest reporting & APOA',
    speaker: 'Elev8 Suite',
    blurb: 'Reporting foreign guests: how APOA works and what it costs to ignore it.',
    file: '',
  },
  {
    title: 'Data protection law',
    speaker: 'Elev8 Suite',
    blurb: "What Indonesia's data protection law asks of hosts and operators.",
    file: '',
  },
  {
    title: 'Direct booking playbook',
    speaker: 'Reto Wyss \u00b7 Elev8 Suite',
    blurb: 'Reaching 40%+ direct bookings without an agency or a developer.',
    file: '',
  },
  {
    title: 'AI in daily operations',
    speaker: 'Reto Wyss \u00b7 Elev8 Suite',
    blurb: 'Where AI earns its place in an operation - and where it does not.',
    file: '',
  },
];

function mount(app) {
  app.get('/slides', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(page());
  });
}

function page() {
  const any = SESSIONS.some((s) => s.file);
  const rows = SESSIONS.map((s) => `
    <article class="s">
      <div class="txt">
        <h3>${s.title}</h3>
        <div class="sp">${s.speaker}</div>
        <p>${s.blurb}</p>
      </div>
      ${s.file
        ? `<a class="dl" href="/decks/${encodeURIComponent(s.file)}" download>Download PDF</a>`
        : '<span class="soon">Coming soon</span>'}
    </article>`).join('');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Slides &middot; Smarter Revenue, Better Tech</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#F7F4EE">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--cream:#F7F4EE;--ink:#111;--gold:#C9A24B;--grey:#555}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:var(--cream);color:var(--ink);line-height:1.5}
.wrap{max-width:780px;margin:0 auto;padding:40px 22px 70px}
.logos{display:flex;align-items:center;justify-content:center;gap:0}
.logos .cell{flex:1;display:flex;justify-content:center}
.logos img{max-height:52px;max-width:100%;height:auto}
.logos img.c{max-height:78px}
h1{font-family:'Archivo Black',sans-serif;text-align:center;font-size:clamp(26px,5vw,40px);
  line-height:1.12;margin-top:26px}
.lead{text-align:center;color:var(--grey);margin-top:12px;font-size:15.5px}
.note{background:#fff;border:1px solid #e5e0d5;border-left:4px solid var(--gold);
  border-radius:12px;padding:16px 18px;margin-top:26px;font-size:14.5px}
.s{background:#fff;border:1px solid #e5e0d5;border-radius:14px;padding:20px 22px;margin-top:14px;
  display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.txt{flex:1;min-width:220px}
.s h3{font-size:17.5px}
.s .sp{font-size:13.5px;color:var(--gold);font-weight:600;margin-top:2px}
.s p{font-size:14.5px;color:#444;margin-top:7px}
.dl{background:var(--ink);color:var(--cream);text-decoration:none;font-weight:700;font-size:14px;
  padding:12px 18px;border-radius:9px;white-space:nowrap}
.soon{font-size:13px;font-weight:600;color:#999;background:#F2EEE5;border-radius:20px;padding:7px 14px;white-space:nowrap}
.cta{background:var(--ink);color:var(--cream);border-radius:14px;padding:26px;margin-top:32px;text-align:center}
.cta b{color:var(--gold)}
.cta a{display:inline-block;margin-top:14px;background:var(--gold);color:#111;text-decoration:none;
  font-weight:700;padding:13px 22px;border-radius:9px}
footer{text-align:center;font-size:13px;color:var(--grey);margin-top:44px}
</style></head><body>
<div class="wrap">
  <div class="logos">
    <div class="cell"><img src="/img/elev8.jpg" alt="Elev8 Suite"></div>
    <div class="cell"><img class="c" src="/img/cha.jpg?v=2" alt="Canggu Hospitality Association"></div>
    <div class="cell"><img src="/img/mekari.jpg?v=2" alt="Mekari"></div>
  </div>

  <h1>SLIDES &amp; RESOURCES</h1>
  <p class="lead">Smarter Revenue, Better Tech &middot; 28 August 2026 &middot; OXO The Factory, Canggu</p>

  ${any ? '' : `<div class="note"><b>The decks are being finalised.</b> Each speaker reviews their slides
    before we publish them here, usually within a few days of the event. Bookmark this page \u2014
    everyone who attended also gets an email the moment they are up.</div>`}

  ${rows}

  <div class="cta">
    <b>Your free revenue strategy analysis</b><br>
    Every registration includes an analysis of your property worth IDR 2.5 million.
    If we have not scheduled yours yet, let us know.
    <br><a href="https://wa.me/6281138407888">Message us on WhatsApp</a>
  </div>

  <footer>An Elev8 Suite event with the Canggu Hospitality Association and Mekari &middot; Bali, Indonesia</footer>
</div>
</body></html>`;
}

module.exports = { mount };
