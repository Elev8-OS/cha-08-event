/**
 * Screen pages: full-bleed QR codes to project at the venue.
 *
 * /screen           -> feedback QR, shown while closing the afternoon
 * /screen/register  -> registration QR, usable before and between sessions
 *
 * Sized for a projector at the back of a room: the code fills roughly a third
 * of the height, the URL is spelled out underneath for anyone whose camera
 * will not cooperate, and the page never scrolls.
 */

const SCREENS = {
  feedback: {
    path: '/feedback',
    kicker: 'BEFORE YOU GO',
    title: 'HOW DID WE DO?',
    lead: 'Three questions, under a minute. It decides what we run next.',
    img: '/img/qrfeedback.png',
  },
  register: {
    path: '/',
    kicker: 'NOT REGISTERED YET?',
    title: 'SECURE YOUR SEAT',
    lead: 'Scan to register \u2014 includes a free revenue strategy analysis worth IDR 2.5 million.',
    img: '/img/qrregister.png',
  },
};

const HOST = process.env.PUBLIC_HOST || 'cha-08.elev8-suite.com';

function mount(app) {
  app.get('/screen', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(page(SCREENS.feedback));
  });

  app.get('/screen/register', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(page(SCREENS.register));
  });
}

function page(s) {
  const url = HOST + (s.path === '/' ? '' : s.path);
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${s.title}</title>
<meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--cream:#F7F4EE;--ink:#111;--gold:#F6BB12;--grey:#666}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden}
body{font-family:Inter,system-ui,sans-serif;background:var(--cream);color:var(--ink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:4vh 4vw;text-align:center;cursor:none}
.logos{display:flex;align-items:center;justify-content:center;gap:5vw;margin-bottom:3vh}
.logos img{height:5vh;width:auto}
.logos img.c{height:7.5vh}
.kicker{font-weight:700;letter-spacing:.35em;font-size:1.7vh;color:var(--grey)}
h1{font-family:'Archivo Black',sans-serif;font-size:6.5vh;line-height:1.05;margin-top:1.2vh}
.lead{font-size:2.4vh;color:#333;margin-top:1.6vh;max-width:62ch}
.qr{margin-top:3.2vh;background:#fff;padding:2.2vh;border-radius:2vh;
  box-shadow:0 1.5vh 5vh rgba(0,0,0,.13);line-height:0}
.qr img{height:40vh;width:40vh;display:block;image-rendering:crisp-edges}
.url{margin-top:2.4vh;font-family:'Archivo Black',sans-serif;font-size:2.6vh;letter-spacing:.02em}
.url span{color:var(--gold)}
.hint{font-size:1.8vh;color:var(--grey);margin-top:1vh}
/* A phone held up next to the screen should still make sense of it */
@media(max-aspect-ratio:1/1){
  .qr img{height:44vw;width:44vw}
  h1{font-size:5vh}.lead{font-size:2vh}.url{font-size:2.2vh}
}
</style></head><body>

<div class="logos">
  <img src="/img/elev8.jpg" alt="Elev8 Suite">
  <img class="c" src="/img/cha.jpg?v=2" alt="Canggu Hospitality Association">
  <img src="/img/mekari.jpg?v=2" alt="Mekari">
</div>

<div class="kicker">${s.kicker}</div>
<h1>${s.title}</h1>
<p class="lead">${s.lead}</p>

<div class="qr"><img src="${s.img}" alt="QR code"></div>

<div class="url">${url.split('/')[0]}<span>${url.slice(url.indexOf('/')) || ''}</span></div>
<div class="hint">Point your camera at the code \u2014 no app needed.</div>

</body></html>`;
}

module.exports = { mount };
