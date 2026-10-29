import * as XLSX from 'xlsx';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dateText(value: Date): string {
  const date = `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(
    value.getDate(),
  )}`;
  const time = `${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(
    value.getSeconds(),
  )}`;
  return time === '00:00:00' ? date : `${date} ${time}`;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dateText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Convert one worksheet into CSV so DuckDB reads it through the existing
 * read_csv_auto path. Dates become ISO text; other cells keep their values.
 */
export function sheetToCsv(buffer: ArrayBuffer, sheetName: string): string {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    sheets: sheetName,
  });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`工作表不存在：${sheetName}`);

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  if (matrix.length === 0) throw new Error(`工作表为空：${sheetName}`);

  const width = Math.max(...matrix.map((row) => row.length));
  return matrix
    .map((row) =>
      Array.from({ length: width }, (_, index) =>
        csvCell(cellText(row[index])),
      ).join(','),
    )
    .join('\r\n');
}
