/**
 * binCardDocumentService.js — renders the formal "Stock Keep Control Form
 * (Bin Card)" as PDF (pdfkit) and DOCX (docx).
 *
 * The layout mirrors the official stock-control form:
 *   • health facility name + document title
 *   • identification fields in the form's order and wording
 *   • a two-row table header where "Quantity" spans Received / Issued /
 *     Loss/Adj / Balance
 *
 * Both builders consume the SAME getBinCardData() rows as the Excel export, so
 * the three files can never disagree. The document is theme-independent: it
 * always renders as black-on-white paper, exactly like a printed form.
 */

const PDFDocument = require('pdfkit');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, VerticalAlign, HeadingLevel, Footer,
  PageNumber, ShadingType,
} = require('docx');

const { readRaw } = require('../config/env');

const FACILITY = readRaw('FACILITY_NAME') || 'HEALTH FACILITY — PHARMACY DEPARTMENT';
const GENERATED_LABEL = 'Generated';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const stamp = (d = new Date()) =>
  `${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/* ── column definition (order matches the official form) ──────────────── */

/** 11 columns; the 4 quantity columns are grouped under "Quantity". */
const COLUMNS = [
  { key: 'date', header: 'Date', width: 62, align: 'left' },
  { key: 'docNo', header: 'Doc. No.', width: 68, align: 'left' },
  { key: 'receivingIssuing', header: 'Receiving or Issuing', width: 76, align: 'left' },
  { key: 'counterparty', header: 'Received from or Issued to', width: 92, align: 'left' },
  { key: 'receivedQty', header: 'Received', width: 54, align: 'right', group: 'Quantity' },
  { key: 'issuedQty', header: 'Issued', width: 54, align: 'right', group: 'Quantity' },
  { key: 'lossAdj', header: 'Loss/Adj', width: 58, align: 'right', group: 'Quantity' },
  { key: 'balance', header: 'Balance', width: 56, align: 'right', group: 'Quantity' },
  { key: 'batchNo', header: 'Batch No.', width: 74, align: 'left' },
  { key: 'expiryDate', header: 'Expiry Date', width: 68, align: 'left' },
  { key: 'remarks', header: 'Remarks', width: 96, align: 'left' },
];

/** Identification fields, in the official form's order and wording. */
const IDENT_FIELDS = (d) => [
  ['Product Name', d.medicine.generic_name],
  ['Brand', d.medicine.brand_name || '—'],
  ['Strength and Dosage Form', `${d.medicine.strength || ''} ${d.medicine.dosage_form || ''}`.trim() || '—'],
  ['Unit of Issue', d.medicine.base_unit],
  ['Maximum Stock Level', num(d.medicine.max_level) || '—'],
  ['Emergency Order Point', num(d.medicine.reorder_level) || '—'],
  ['Average Monthly Consumption (AMC)', `${d.amc} units / month`],
];

/** Lines printed under the table — a balance inconsistency is never hidden. */
function notesFor(d) {
  const notes = [
    'Balance is the authoritative running balance recorded on each stock movement (stock_movements.new_stock).',
  ];
  if (!d.hasHistory) {
    notes.push('NO TRANSACTION HISTORY: no stock movements are recorded for this medicine, so no historical balances can be shown. The opening balance shown is the current stock, not a historical figure.');
  } else if (d.reconciled) {
    notes.push(`Reconstructed running balance (${d.reconstructed}) matches the last recorded balance (${d.lastDbBalance}).`);
  } else {
    notes.push(`LIMITATION: the reconstructed running balance (${d.reconstructed}) does not match the last recorded balance (${d.lastDbBalance}). Filters may exclude earlier movements, or history is incomplete — the Balance column (database truth) should be trusted.`);
  }
  if (d.truncated) notes.push('Only the first 3,000 movements are included; the dataset was larger.');
  return notes;
}

/* ═══════════════════════════════════════════════════════════════════════
   PDF (pdfkit) — A4 landscape
   ═══════════════════════════════════════════════════════════════════════ */

function binCardPdf(data) {
  return new Promise((resolve, reject) => {
    const LANDSCAPE = { size: 'A4', layout: 'landscape', margin: 32 };
    const doc = new PDFDocument(LANDSCAPE);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const startX = 32;
    const pageW = doc.page.width - 64;
    const rowH = 16;

    // ── Titles
    doc.font('Helvetica-Bold').fontSize(13).text(FACILITY, { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(12).text('STOCK KEEP CONTROL FORM (BIN CARD)', { align: 'center' });
    doc.font('Helvetica').fontSize(7.5)
      .text(`${GENERATED_LABEL}: ${stamp()}   ·   Filters: ${data.filters}`, { align: 'center' });
    doc.moveDown(0.8);

    // ── Identification block, two fields per row
    const fields = IDENT_FIELDS(data);
    const colW = pageW / 2 - 8;
    const iy = doc.y;
    doc.fontSize(8);
    fields.forEach(([label, value], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = startX + col * (colW + 16);
      const y = iy + row * 14;
      doc.font('Helvetica-Bold').text(`${label}:`, x, y, { width: 124, continued: true });
      doc.font('Helvetica').text(` ${value}`, { width: colW - 128 });
    });
    doc.y = iy + Math.ceil(fields.length / 2) * 14 + 6;
    doc.font('Helvetica-Bold').fontSize(8)
      .text(`Opening Stock: ${data.opening} ${data.medicine.base_unit || ''}`, startX, doc.y);
    doc.moveDown(0.7);

    // ── Column geometry
    const raw = COLUMNS.map((c) => c.width);
    const scale = pageW / raw.reduce((a, b) => a + b, 0);
    const w = raw.map((x) => x * scale);
    const xs = [];
    let acc = startX;
    w.forEach((cw) => { xs.push(acc); acc += cw; });

    const stroke = (x, y, cw, ch) => doc.rect(x, y, cw, ch).lineWidth(0.6).strokeColor('#000').stroke();
    const cell = (text, x, y, cw, ch, opts = {}) => {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.size || 7)
        .fillColor('#000')
        .text(String(text ?? ''), x + 3, y + 4.5, {
          width: cw - 6, align: opts.align || 'left', lineBreak: false, ellipsis: true,
        });
      stroke(x, y, cw, ch);
    };

    // Grouped header: "Quantity" spans the four quantity columns.
    const groupIdx = COLUMNS.map((c, i) => (c.group ? i : -1)).filter((i) => i >= 0);
    const gStart = groupIdx[0];
    const gEnd = groupIdx[groupIdx.length - 1];
    const groupW = w.slice(gStart, gEnd + 1).reduce((a, b) => a + b, 0);

    const drawHeader = (y) => {
      COLUMNS.forEach((c, i) => {
        if (groupIdx.includes(i)) return;
        cell(c.header, xs[i], y, w[i], rowH, { bold: true, align: c.align === 'right' ? 'right' : 'center' });
      });
      cell('Quantity', xs[gStart], y, groupW, rowH, { bold: true, align: 'center' });
      const y2 = y + rowH;
      COLUMNS.forEach((c, i) => cell(c.header, xs[i], y2, w[i], rowH, {
        bold: true, align: c.align === 'right' ? 'right' : 'center',
      }));
      return y2 + rowH;
    };

    let hy = drawHeader(doc.y);

    data.rows.forEach((r, idx) => {
      if (hy + rowH > doc.page.height - 46) {
        doc.addPage(LANDSCAPE);
        hy = drawHeader(32); // repeat the grouped header on every page
      }
      if (idx % 2 === 1) {
        doc.save().fillColor('#f4f4f4');
        w.forEach((cw, i) => doc.rect(xs[i], hy, cw, rowH).fill());
        doc.restore();
      }
      COLUMNS.forEach((c, i) => {
        const raw2 = r[c.key];
        const text = (typeof raw2 === 'number') ? (raw2 === 0 ? '' : raw2) : raw2;
        cell(text, xs[i], hy, w[i], rowH, { align: c.align });
      });
      hy += rowH;
    });

    // ── Notes
    if (hy + 30 > doc.page.height - 46) { doc.addPage(LANDSCAPE); hy = 32; }
    doc.y = hy + 8;
    doc.font('Helvetica-Bold').fontSize(7).text('Notes:', startX, doc.y);
    doc.font('Helvetica').fontSize(7);
    notesFor(data).forEach((n) => doc.text(`• ${n}`, startX + 14, doc.y, { width: pageW - 16 }));

    // ── Page numbers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7).fillColor('#000')
        .text(`Page ${i - range.start + 1} of ${range.count}`, startX, doc.page.height - 26, {
          width: pageW, align: 'center', lineBreak: false,
        });
    }

    doc.end();
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   DOCX (docx) — a genuine, editable Word document
   ═══════════════════════════════════════════════════════════════════════ */

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const THIN = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const borders = (all = THIN) => ({ top: all, bottom: all, left: all, right: all });

function binCardDocx(data) {
  const cell = (text, opts = {}) => new TableCell({
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      spacing: { before: 20, after: 20 },
      children: [new TextRun({
        text: String(text === null || text === undefined ? '' : text),
        bold: Boolean(opts.bold), size: opts.size || 16,
      })],
    })],
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    columnSpan: opts.span,
    borders: borders(),
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade } : undefined,
    verticalAlign: VerticalAlign.CENTER,
  });

  // Identification fields, two label/value pairs per row.
  const fields = IDENT_FIELDS(data);
  const identRows = [];
  for (let i = 0; i < fields.length; i += 2) {
    const pair = [fields[i], fields[i + 1]].filter(Boolean);
    identRows.push(new TableRow({
      children: pair.flatMap(([label, value]) => [
        cell(`${label}:`, { bold: true, width: 22, shade: 'F2F2F2' }),
        cell(value || '—', { width: 28 }),
      ]),
    }));
  }

  // Grouped header row: "Quantity" spans the four quantity columns.
  const gCols = COLUMNS.filter((c) => c.group);
  const plainCols = COLUMNS.filter((c) => !c.group);

  const header1 = new TableRow({
    tableHeader: true, // repeated on every page
    children: [
      ...plainCols.map((c) => cell(c.header, { bold: true, shade: 'E8E8E8', align: AlignmentType.CENTER })),
      cell('Quantity', { bold: true, shade: 'E8E8E8', align: AlignmentType.CENTER, span: gCols.length }),
    ],
  });

  const header2 = new TableRow({
    tableHeader: true,
    children: COLUMNS.map((c) => cell(c.header, {
      bold: true, shade: 'E8E8E8',
      align: c.align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER,
    })),
  });

  const bodyRows = data.rows.map((r) => new TableRow({
    children: COLUMNS.map((c) => {
      const raw = r[c.key];
      const text = (typeof raw === 'number') ? (raw === 0 ? '' : raw) : raw;
      return cell(text, { align: c.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT });
    }),
  }));

  if (!bodyRows.length) {
    bodyRows.push(new TableRow({
      children: [new TableCell({
        columnSpan: COLUMNS.length,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: 'No stock movements recorded for this medicine.', italics: true, size: 16,
          })],
        })],
        borders: borders(),
      })],
    }));
  }

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, spacing: { after: 60 },
      children: [new TextRun({ text: FACILITY, bold: true, size: 26 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [new TextRun({ text: 'STOCK KEEP CONTROL FORM (BIN CARD)', bold: true, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 160 },
      children: [new TextRun({
        text: `${GENERATED_LABEL}: ${stamp()}   ·   Filters: ${data.filters}`, size: 16,
      })],
    }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: identRows }),
    new Paragraph({
      spacing: { before: 120, after: 120 },
      children: [new TextRun({
        text: `Opening Stock: ${data.opening} ${data.medicine.base_unit || ''}`, bold: true, size: 18,
      })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [header1, header2, ...bodyRows],
    }),
    new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: 'Notes:', bold: true, size: 16 })] }),
    ...notesFor(data).map((n) => new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text: n, size: 16 })],
    })),
  ];

  const doc = new Document({
    creator: FACILITY,
    title: `Bin Card — ${data.medicine.generic_name}`,
    description: 'Stock Keep Control Form (Bin Card)',
    sections: [{
      properties: { page: { size: { orientation: 'landscape' } } },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 16,
          })],
        })] }),
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { binCardPdf, binCardDocx, COLUMNS, FACILITY, notesFor };