type Row = Record<string, unknown>;

const escapeCell = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  const str = typeof value === "string" ? value : JSON.stringify(value);
  const escaped = str.replaceAll('"', '""');
  return `"${escaped}"`;
};

export const toCsv = (rows: Row[]): string => {
  if (rows.length === 0) {
    return "";
  }

  const headers = Array.from(
    rows.reduce((set, row) => {
      for (const key of Object.keys(row)) {
        set.add(key);
      }
      return set;
    }, new Set<string>())
  );

  const headerLine = headers.map((key) => escapeCell(key)).join(",");
  const body = rows.map((row) => headers.map((key) => escapeCell(row[key])).join(",")).join("\n");

  return `${headerLine}\n${body}`;
};
