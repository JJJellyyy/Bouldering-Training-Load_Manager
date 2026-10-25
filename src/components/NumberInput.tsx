import { useState } from "react";

interface NumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

/** Display a value with no more decimals than the step allows (0.25 → 2), so stored floats don't show 15 digits. */
function formatForStep(value: number, step?: number): string {
  const decimals = step === undefined ? 2 : (String(step).split(".")[1]?.length ?? 0);
  return String(Number(value.toFixed(decimals)));
}

export function NumberInput({ value, onCommit, min, max, step }: NumberInputProps) {
  const [text, setText] = useState<string>(formatForStep(value, step));
  const [syncedValue, setSyncedValue] = useState(value);

  // When the value changes from outside, show it (adjusting state during render, as React recommends over an effect).
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(formatForStep(value, step));
  }

  function commitValue() {
    if (text.trim() === "") {
      setText(formatForStep(value, step));
      return;
    }

    const parsed = Number(text);
    if (Number.isNaN(parsed)) {
      setText(formatForStep(value, step));
      return;
    }

    let next = parsed;
    if (typeof min === "number") {
      next = Math.max(min, next);
    }
    if (typeof max === "number") {
      next = Math.min(max, next);
    }

    onCommit(next);
    setText(formatForStep(next, step));
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commitValue}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commitValue();
        }

        if (event.key === "Escape") {
          setText(formatForStep(value, step));
        }
      }}
    />
  );
}
