import type { StrengthSet } from "../types";

const LBS_TO_KG = 0.45359237;

export interface FitNotesParseResult {
  sets: StrengthSet[];
  skippedRows: number;
}

/** Split CSV text into rows of fields, honouring quoted fields with embedded commas, quotes and newlines. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function parseDurationSeconds(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const parts = trimmed.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parse a FitNotes CSV export (Settings → Export → CSV).
 * Expected header: Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment
 */
export function parseFitNotesCsv(text: string): FitNotesParseResult {
  const rows = parseCsvRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (rows.length === 0) {
    throw new Error("The file is empty.");
  }

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const idx = {
    date: col("date"),
    exercise: col("exercise"),
    category: col("category"),
    weight: col("weight"),
    weightUnit: col("weight unit"),
    reps: col("reps"),
    distance: col("distance"),
    distanceUnit: col("distance unit"),
    time: col("time"),
    comment: col("comment"),
  };

  if (idx.date < 0 || idx.exercise < 0 || idx.reps < 0) {
    throw new Error("This doesn't look like a FitNotes CSV export (missing Date, Exercise or Reps column).");
  }

  const sets: StrengthSet[] = [];
  const seenPerDay = new Map<string, number>();
  let skippedRows = 0;

  for (const cells of rows.slice(1)) {
    const cell = (index: number) => (index >= 0 ? (cells[index] ?? "") : "");
    const date = cell(idx.date).trim();
    const exercise = cell(idx.exercise).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !exercise) {
      skippedRows++;
      continue;
    }

    const rawWeight = parseOptionalNumber(cell(idx.weight)) ?? 0;
    const unit = cell(idx.weightUnit).trim().toLowerCase();
    const weightKg = unit.startsWith("lb") ? rawWeight * LBS_TO_KG : rawWeight;
    const reps = parseOptionalNumber(cell(idx.reps)) ?? 0;
    const timeSeconds = parseDurationSeconds(cell(idx.time));

    if (reps <= 0 && !timeSeconds) {
      skippedRows++;
      continue;
    }

    // Sets have no id in the export; date + exercise + position within that day is stable across re-exports.
    const dayKey = `${date}|${exercise}`;
    const position = seenPerDay.get(dayKey) ?? 0;
    seenPerDay.set(dayKey, position + 1);

    const comment = cell(idx.comment).trim();
    sets.push({
      id: `fitnotes-${dayKey}|${position}`,
      date,
      exercise,
      category: cell(idx.category).trim() || "Other",
      weightKg,
      reps,
      distance: parseOptionalNumber(cell(idx.distance)),
      distanceUnit: cell(idx.distanceUnit).trim() || undefined,
      timeSeconds,
      comment: comment || undefined,
    });
  }

  return { sets, skippedRows };
}
