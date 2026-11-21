// Fast CSV reader matching csv-reader 1.0.0 exactly.
// SPDX-License-Identifier: MIT
//
// Design: two clearly separated paths, dispatched per record.
//  - FAST path: a record whose line holds no double-quote before its
//    next LF is handled with indexOf/split only. No quote can open, so
//    every comma is a separator and the only special character is CR
//    (a trailing CRLF, or stray CRs dropped with a stray_cr error).
//  - SLOW path: any record containing a quote before its next LF goes
//    through a field-by-field parser that also uses indexOf to jump
//    between delimiters, handling quoted fields, doubled quotes,
//    CRLF / lone CR inside quotes (read as LF), quote_junk and
//    unterminated_quote exactly as the reference does.
//
// Semantics (reference): U+FEFF dropped at the very start; a record
// ends at LF or CRLF; a line left with no characters is no record;
// outside quotes a CR not followed by LF is dropped (stray_cr); a
// field opening with a quote runs to the next non-doubled quote,
// "" inside is one quote, CRLF/lone CR inside is LF, text after the
// closing quote up to the next comma or line break is appended as it
// stands (quote_junk when the field ends); a quote that never closes
// is a literal and the text after it is re-read as unquoted
// (unterminated_quote); a quote inside an unquoted field is literal;
// fields stay strings, never trimmed or converted; rows are padded
// (short_row, fields: count) or cut (long_row, extra: cut fields) to
// the first record's width; errors are {code, line, row} in the order
// met, line = 1-based line the record starts on, row = its index in
// rows (null for the header).

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // Finish one parsed record: width, header, short/long row, push.
  // Returns nothing; `fields` is mutated for padding/cutting.
  function finish(fields, recordLine, recordRow) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // ---- FAST PATH: one whole unquoted record line -----------------
  // pos is at the first char of a record, nl is the index of the next
  // LF at or after pos (-1 = EOF), and there is no '"' in [pos, nl).
  // Returns true when the record was consumed by the fast path.
  function fastRecord(recordLine, recordRow) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? n : nl;
    // Find CRs in this line. Most lines have none: split directly.
    let cr = text.indexOf('\r', pos);
    if (cr === -1 || cr >= end) {
      const fields = text.slice(pos, end).split(',');
      pos = nl === -1 ? n : nl + 1;
      line += 1;
      if (fields.length === 1 && fields[0] === '') return true; // stray-CR-only / empty: no record
      finish(fields, recordLine, recordRow);
      return true;
    }
    // Line holds CR(s): the last one is the CRLF terminator when it
    // sits just before the LF; every other CR is a stray_cr, dropped.
    // A CR at EOF (no LF) is stray too.
    let cleaned = '';
    let scan = pos;
    while (cr !== -1 && cr < end) {
      const isTerminator = nl !== -1 && cr === end - 1;
      if (!isTerminator) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      cleaned += text.slice(scan, cr);
      scan = cr + 1;
      cr = text.indexOf('\r', scan);
    }
    cleaned += text.slice(scan, end);
    pos = nl === -1 ? n : nl + 1;
    line += 1;
    const fields = cleaned.split(',');
    if (fields.length === 1 && fields[0] === '') return true;
    finish(fields, recordLine, recordRow);
    return true;
  }

  // ---- SLOW PATH helpers -----------------------------------------
  // Read unquoted characters starting at pos, appending to `value`,
  // up to the next comma or line break. Returns [value, ended] where
  // ended is 0 = comma, 1 = line break, 2 = end of text. `addedOut`
  // counts kept characters (for quote_junk). Stray CRs are dropped
  // with a stray_cr error each, in order met.
  function readUnquoted(value, recordLine, recordRow) {
    let added = 0;
    while (pos < n) {
      const cComma = text.indexOf(',', pos);
      const cLf = text.indexOf('\n', pos);
      const cCr = text.indexOf('\r', pos);
      let cut = n;
      let kind = 2;
      if (cComma !== -1 && cComma < cut) { cut = cComma; kind = 0; }
      if (cLf !== -1 && cLf < cut) { cut = cLf; kind = 1; }
      if (cCr !== -1 && cCr < cut) { cut = cCr; kind = 3; }
      if (cut > pos) {
        value += text.slice(pos, cut);
        added += cut - pos;
      }
      if (kind === 2) { pos = n; return [value, 2, added]; }
      if (kind === 0) { pos = cut + 1; return [value, 0, added]; }
      if (kind === 1) { pos = cut + 1; line += 1; return [value, 1, added]; }
      // Lone CR or CRLF at cut.
      if (text.charCodeAt(cut + 1) === 10) { pos = cut + 2; line += 1; return [value, 1, added]; }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = cut + 1;
    }
    return [value, 2, added];
  }

  // Read a quoted field whose opening quote is at pos.
  // Returns [value, ended, quotedFlag] with ended as above.
  function readQuoted(recordLine, recordRow) {
    const open = pos;
    const openLine = line;
    let cur = pos + 1;
    const parts = [];
    while (true) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        // Never closes: quote is a literal, text after it re-read
        // as unquoted. The unterminated error comes first.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"', recordLine, recordRow);
      }
      // Segment cur..q: transform CRLF / lone CR to LF, count lines.
      if (q > cur) {
        const seg = text.slice(cur, q);
        const hasCr = seg.indexOf('\r') !== -1;
        const hasLf = seg.indexOf('\n') !== -1;
        if (!hasCr && !hasLf) {
          parts.push(seg);
        } else if (!hasCr) {
          // Only LFs: count them for the line number.
          let c = 0;
          let i = seg.indexOf('\n');
          while (i !== -1) { c += 1; i = seg.indexOf('\n', i + 1); }
          line += c;
          parts.push(seg);
        } else {
          // Count line breaks (CRLF counts once) and normalise.
          let c = 0;
          let i = 0;
          while (i < seg.length) {
            const ch = seg.charCodeAt(i);
            if (ch === 13) { c += 1; i += seg.charCodeAt(i + 1) === 10 ? 2 : 1; }
            else if (ch === 10) { c += 1; i += 1; }
            else i += 1;
          }
          line += c;
          parts.push(seg.replace(/\r\n?/g, '\n'));
        }
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one literal quote, keep scanning.
        parts.push('"');
        cur = q + 2;
        continue;
      }
      // Closing quote found.
      pos = q + 1;
      const value = parts.join('');
      if (pos >= n) return [value, 2, 0];
      const ch = text.charCodeAt(pos);
      if (ch === 44) { pos += 1; return [value, 0, 0]; }
      if (ch === 10) { pos += 1; line += 1; return [value, 1, 0]; }
      if (ch === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; return [value, 1, 0]; }
      // Junk after the closing quote, appended as it stands.
      const junk = readUnquoted(value, recordLine, recordRow);
      if (junk[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
  }

  // Parse one record through the slow path. Returns the fields plus
  // whether the last field was quoted (for the stray-CR-only rule).
  function slowRecord(recordLine, recordRow) {
    const fields = [];
    let lastQuoted = false;
    let ended;
    do {
      lastQuoted = text.charCodeAt(pos) === 34;
      const r = lastQuoted
        ? readQuoted(recordLine, recordRow)
        : readUnquoted('', recordLine, recordRow);
      fields.push(r[0]);
      ended = r[1];
    } while (ended === 0);
    return [fields, lastQuoted];
  }

  // ---- MAIN LOOP ---------------------------------------------------
  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    // Dispatch: fast when no quote opens before the next LF (or EOF);
    // otherwise the slow path handles quotes / embedded line breaks.
    const nl = text.indexOf('\n', pos);
    const q = text.indexOf('"', pos);
    if (q === -1 || (nl !== -1 && q > nl)) {
      fastRecord(recordLine, recordRow);
    } else {
      const [fields, lastQuoted] = slowRecord(recordLine, recordRow);
      // A line that held only stray CRs is left with no characters:
      // no record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
      finish(fields, recordLine, recordRow);
    }
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
