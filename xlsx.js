/**
 * A very small .xlsx writer: header row, data rows, nothing else.
 *
 * Written by hand rather than pulled from npm on purpose. The whole app has
 * one dependency, this runs on a Railway box the day before an event, and the
 * spreadsheet libraries that do this properly weigh more than everything else
 * here put together. What a door list needs is a bold header, frozen top row,
 * an autofilter and sane column widths, and that is a few hundred bytes of XML
 * in a zip.
 *
 * sheet({ name, columns, rows }) -> Buffer
 *   columns: [{ header, width, type }]  type: 'text' (default) | 'number' | 'money'
 *   rows:    arrays of values, one per column
 */

const zlib = require('zlib');

// --- zip ----------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// DOS timestamp. Excel does not care what it says, only that it parses.
function dosTime(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

function zip(files, when) {
  const stamp = dosTime(when || new Date());
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.data, 'utf8');
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 filenames
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, deflated);

    const dir = Buffer.alloc(46 + name.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);            // version made by
    dir.writeUInt16LE(20, 6);            // version needed
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(stamp.time, 12);
    dir.writeUInt16LE(stamp.date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(0, 38);            // external attributes
    dir.writeUInt32LE(offset, 42);
    name.copy(dir, 46);
    central.push(dir);

    offset += local.length + deflated.length;
  }

  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, dirBuf, end]);
}

// --- xml ----------------------------------------------------------------

// XML 1.0 has no escape for most control characters - they cannot appear at
// all. A name pasted out of a PDF can carry one, and Excel refuses the whole
// file over it, so they are dropped rather than encoded.
function xml(s) {
  return String(s ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// 1 -> A, 27 -> AA
function colName(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - r - 1) / 26;
  }
  return s;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Style 1 is the header, 2 is the thousands-separated number used for money.
const STYLES = HEAD + `<styleSheet xmlns="${NS}">
<fonts count="2">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF111111"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cell(ref, value, type) {
  if (value === null || value === undefined || value === '') return `<c r="${ref}"/>`;
  if (type === 'number' || type === 'money') {
    const n = Number(value);
    // A number Excel cannot hold is better shown than silently turned into 0
    if (!Number.isFinite(n)) return `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    return `<c r="${ref}"${type === 'money' ? ' s="2"' : ''}><v>${n}</v></c>`;
  }
  // xml:space matters: a value that starts or ends with a space keeps it
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheetXml(columns, rows) {
  const last = colName(columns.length);
  const span = `A1:${last}${rows.length + 1}`;

  const header = '<row r="1" ht="20" customHeight="1">' + columns
    .map((c, i) => `<c r="${colName(i + 1)}1" s="1" t="inlineStr"><is><t>${xml(c.header)}</t></is></c>`)
    .join('') + '</row>';

  const body = rows.map((r, ri) => '<row r="' + (ri + 2) + '">' + columns
    .map((c, ci) => cell(colName(ci + 1) + (ri + 2), r[ci], c.type))
    .join('') + '</row>').join('');

  const cols = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`)
    .join('');

  // Element order is fixed by the schema: dimension, sheetViews, format,
  // cols, sheetData, then autoFilter. Out of order, Excel calls the file
  // corrupt and repairs it instead of opening it.
  return HEAD + `<worksheet xmlns="${NS}">`
    + `<dimension ref="${span}"/>`
    + '<sheetViews><sheetView tabSelected="1" workbookViewId="0">'
    + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
    + '</sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${cols}</cols>`
    + `<sheetData>${header}${body}</sheetData>`
    + `<autoFilter ref="${span}"/>`
    + '</worksheet>';
}

/** Build a one-sheet workbook. Returns a Buffer ready to send. */
function sheet({ name, columns, rows }, when) {
  // Excel's own limits on a sheet name, enforced here so a caller cannot
  // produce a file that will not open.
  const title = String(name || 'Sheet1').replace(/[\\/*?:\[\]]/g, ' ').slice(0, 31) || 'Sheet1';

  return zip([
    {
      name: '[Content_Types].xml',
      data: HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '</Types>',
    },
    {
      name: '_rels/.rels',
      data: HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>`
        + '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data: HEAD + `<workbook xmlns="${NS}" xmlns:r="${REL}">`
        + `<sheets><sheet name="${xml(title)}" sheetId="1" r:id="rId1"/></sheets>`
        + '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>`
        + `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>`
        + '</Relationships>',
    },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(columns, rows) },
  ], when);
}

module.exports = { sheet };
