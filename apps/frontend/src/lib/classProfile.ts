export type StructuredGridValue = {
    kind: "grid";
    rows: number;
    cols: number;
    cells: string[][];
};

export type StructuredCommitteeMember = {
    position: string;
    name: string;
};

export type StructuredCommitteeValue = {
    kind: "committee";
    members: StructuredCommitteeMember[];
};

const clampSize = (value: number): number => Math.max(1, Math.min(20, Number.isFinite(value) ? value : 1));

export const createGrid = (rows: number, cols: number, seed?: string[][]): StructuredGridValue => {
    const safeRows = clampSize(rows);
    const safeCols = clampSize(cols);
    return {
        kind: "grid",
        rows: safeRows,
        cols: safeCols,
        cells: Array.from({ length: safeRows }, (_, rowIndex) =>
            Array.from({ length: safeCols }, (_, colIndex) => seed?.[rowIndex]?.[colIndex] ?? "")
        )
    };
};

export const parseStructuredGrid = (raw: string | null | undefined): { mode: "grid"; value: StructuredGridValue } | { mode: "text"; value: string } => {
    const source = String(raw ?? "").trim();
    if (!source) {
        return { mode: "grid", value: createGrid(5, 7) };
    }

    try {
        const parsed = JSON.parse(source) as unknown;
        if (Array.isArray(parsed)) {
            if (parsed.every((item) => Array.isArray(item))) {
                const rows = parsed.length;
                const cols = Math.max(...parsed.map((item) => (Array.isArray(item) ? item.length : 0)), 0);
                return {
                    mode: "grid",
                    value: createGrid(
                        rows || 1,
                        cols || 1,
                        parsed.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
                    )
                };
            }
        }

        if (parsed && typeof parsed === "object") {
            const typed = parsed as { kind?: string; rows?: number; cols?: number; cells?: unknown };
            if (typed.kind === "grid" && Array.isArray(typed.cells)) {
                return {
                    mode: "grid",
                    value: createGrid(
                        typed.rows ?? typed.cells.length,
                        typed.cols ?? Math.max(...typed.cells.map((item) => (Array.isArray(item) ? item.length : 0)), 1),
                        (typed.cells as unknown[]).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
                    )
                };
            }
        }
    } catch {
        // ignore
    }

    return { mode: "text", value: source };
};

export const serializeStructuredGrid = (mode: "grid" | "text", gridValue: StructuredGridValue, textValue: string): string => {
    if (mode === "text") {
        return textValue.trim();
    }
    return JSON.stringify(gridValue);
};

export const updateGridCell = (grid: StructuredGridValue, rowIndex: number, colIndex: number, value: string): StructuredGridValue => {
    const nextCells = grid.cells.map((row, currentRowIndex) =>
        row.map((cell, currentColIndex) => (currentRowIndex === rowIndex && currentColIndex === colIndex ? value : cell))
    );
    return { ...grid, cells: nextCells };
};

export const parseStructuredCommittee = (raw: string | null | undefined): { mode: "committee"; value: StructuredCommitteeValue } | { mode: "text"; value: string } => {
    const source = String(raw ?? "").trim();
    if (!source) {
        return { mode: "committee", value: { kind: "committee", members: [] } };
    }

    try {
        const parsed = JSON.parse(source) as unknown;
        if (Array.isArray(parsed)) {
            const members = parsed
                .filter((item) => item && typeof item === "object")
                .map((item) => ({
                    position: String((item as { position?: unknown }).position ?? ""),
                    name: String((item as { name?: unknown }).name ?? "")
                }));
            return { mode: "committee", value: { kind: "committee", members } };
        }
        if (parsed && typeof parsed === "object") {
            const typed = parsed as { kind?: string; members?: unknown[] };
            if (typed.kind === "committee" && Array.isArray(typed.members)) {
                return {
                    mode: "committee",
                    value: {
                        kind: "committee",
                        members: typed.members.map((item) => ({
                            position: String((item as { position?: unknown }).position ?? ""),
                            name: String((item as { name?: unknown }).name ?? "")
                        }))
                    }
                };
            }
        }
    } catch {
        // ignore
    }

    return { mode: "text", value: source };
};

export const serializeStructuredCommittee = (
    mode: "committee" | "text",
    committeeValue: StructuredCommitteeValue,
    textValue: string
): string => {
    if (mode === "text") {
        return textValue.trim();
    }
    return JSON.stringify(committeeValue.members.filter((item) => item.position.trim() || item.name.trim()));
};

export const randomizeSeatGrid = (grid: StructuredGridValue, names: string[]): StructuredGridValue => {
    const shuffled = [...names];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const targetIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[targetIndex]] = [shuffled[targetIndex], shuffled[index]];
    }

    const next = createGrid(grid.rows, grid.cols);
    let cursor = 0;
    for (let rowIndex = 0; rowIndex < grid.rows; rowIndex += 1) {
        for (let colIndex = 0; colIndex < grid.cols; colIndex += 1) {
            next.cells[rowIndex][colIndex] = shuffled[cursor] ?? "";
            cursor += 1;
        }
    }
    return next;
};
