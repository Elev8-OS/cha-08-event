/**
 * Version and changelog.
 *
 * The version is shown in the admin and at the check-in desk so that when
 * something behaves oddly on the day, the first question - "which build is
 * that tablet actually running?" - has an answer you can read out loud.
 *
 * Bump VERSION whenever behaviour changes, and add the entry at the top.
 */

const VERSION = '1.7.1';

const CHANGELOG = [
  {
    v: '1.7.1', date: '2026-08-16', title: 'Counting and finding things',
    items: [
      'Header counts seats throughout: a complimentary booking of two seats '
        + 'was showing as one.',
      'Duplicate questions are caught while typing, with the option to back the '
        + 'existing one instead of asking it twice.',
      'The registration screen showed the domain with a doubled last letter.',
      'Admin buttons grouped by when you need them: on the day, on the screen, '
        + 'afterwards, data.',
    ],
  },
  {
    v: '1.7.0', date: '2026-08-16', title: 'Questions from the room',
    items: [
      'A QR on the screen during the coffee break: people type the question they '
        + 'did not want to ask in front of the room.',
      'Questions can be backed rather than repeated, and the moderator sees them '
        + 'sorted by how many people wanted them asked.',
      'Marking one as answered removes it from the audience list too.',
      'Admin toolbar: Questions, Questions QR and Feedback QR.',
    ],
  },
  {
    v: '1.6.1', date: '2026-08-16', title: 'Badges to fit the pouches',
    items: [
      'Name badges are 70x105 mm portrait, four per A4 sheet - the paper size '
        + 'that fits the lanyard pouches, not the old 90x54 mm card.',
      'Bigger name, venue and date on every badge.',
    ],
  },
  {
    v: '1.6.0', date: '2026-08-16', title: 'Counting people, not bookings',
    items: [
      'Check-in counts arrivals per seat: a party of three can arrive as two.',
      'Undoing a check-in now removes the Attended tag in the CRM as well - '
        + 'before, it stayed behind and the follow-up went to someone who never came.',
      'Version and changelog visible in the admin and at the desk.',
    ],
  },
  {
    v: '1.5.0', date: '2026-08-16', title: 'Invited guests and the desk',
    items: [
      'Complimentary status: internal guests count towards the head count and '
        + 'receive the email flow, but not towards revenue and never show as unpaid.',
      'Walk-ins require an email and WhatsApp number, so they reach the CRM.',
      'Projectable QR screens for feedback and registration.',
    ],
  },
  {
    v: '1.4.0', date: '2026-08-16', title: 'Around the event',
    items: [
      'Slides page, live from day one so the link in the follow-up never 404s.',
      'Feedback form with an admin summary, plus a list of who attended and has '
        + 'not answered yet.',
      'Feedback links from email identify the sender; the projected QR stays anonymous.',
      'Printable name badges.',
    ],
  },
  {
    v: '1.3.0', date: '2026-08-16', title: 'Capacity',
    items: [
      'Seat cap of 70 with an automatic waitlist - nothing is charged to a waitlisted guest.',
      'The landing page only shows the seat count once it is low enough to persuade.',
      'Walk-in registration at the reception desk.',
    ],
  },
  {
    v: '1.2.0', date: '2026-08-16', title: 'Running it from a phone',
    items: [
      'Admin rebuilt as cards - the fourteen-column table was unusable on a phone.',
      'Archive browser with per-entry restore, password protected.',
      'Individual registrations can be archived instead of clearing everything.',
      'Home screen icon for admin and check-in.',
    ],
  },
  {
    v: '1.1.0', date: '2026-08-16', title: 'The reception desk',
    items: [
      'Tablet check-in: search, tap to arrive, undo, live seat counter.',
      'Check-in writes the Attended tag to the CRM.',
      'Visitor statistics without storing IP addresses.',
    ],
  },
  {
    v: '1.0.0', date: '2026-08-15', title: 'Live',
    items: [
      'Landing page with registration, bank transfer and proof upload.',
      'CRM sync with tags, custom fields and owner assignment.',
      'Admin list, CSV export, payment verification.',
    ],
  },
];

function mount(app, deps) {
  const { guard } = deps;

  app.get('/admin/changelog', (req, res) => {
    if (!guard(req, res)) return;
    const k = encodeURIComponent(req.query.key);
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

    const blocks = CHANGELOG.map((r, i) => `
      <section${i === 0 ? ' class="now"' : ''}>
        <h2>${esc(r.v)} <span>${esc(r.date)}</span>${i === 0 ? '<b class="live">running now</b>' : ''}</h2>
        <h3>${esc(r.title)}</h3>
        <ul>${r.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </section>`).join('');

    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Changelog</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#111111">
    <link rel="apple-touch-icon" href="/img/appicon.png">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>*{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Inter,system-ui,sans-serif;background:#F7F4EE;color:#111;padding:18px;max-width:760px;
      padding-bottom:calc(30px + env(safe-area-inset-bottom))}
    h1{font-size:20px;margin:6px 0 4px}
    .lead{color:#666;font-size:14px;margin-bottom:18px}
    section{background:#fff;border:1px solid #e5e0d5;border-radius:14px;padding:18px 20px;margin-bottom:12px}
    section.now{border-color:#F6BB12;border-width:2px}
    h2{font-size:17px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    h2 span{font-weight:500;font-size:13px;color:#999}
    h2 .live{background:#F6BB12;color:#111;font-size:11px;letter-spacing:1px;
      text-transform:uppercase;padding:3px 9px;border-radius:20px}
    h3{font-size:14.5px;color:#8A6D2F;margin-top:4px}
    ul{margin:10px 0 0 18px}
    li{font-size:14.5px;line-height:1.55;color:#333;margin-bottom:6px}
    a{color:#333}</style></head><body>
    <p><a href="/admin?key=${k}">&larr; Back to registrations</a></p>
    <h1>Changelog</h1>
    <p class="lead">What changed, and why. The version at the top is what this
      server is running right now &mdash; the desk tablet shows the same number.</p>
    ${blocks}
    </body></html>`);
  });
}

module.exports = { VERSION, CHANGELOG, mount };
