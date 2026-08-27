import { useEffect, useState } from "react";
import { formatFixedNumber, formatNumber2 } from "../utils/numberFormatBridge";

interface NumericEntryInputProps {
  value: number | null | undefined;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  disabled?: boolean;
  step?: string;
  precision?: number;
}

/** Keeps form state numeric while presenting grouped, two-decimal values at rest. */
export default function NumericEntryInput({
  value,
  onChange,
  className,
  placeholder,
  disabled = false,
  step,
  precision
}: NumericEntryInputProps) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!focused) {
      setText(value === null || value === undefined
        ? ""
        : precision === undefined
          ? formatNumber2(value)
          : formatFixedNumber(value, precision));
    }
  }, [focused, precision, value]);

  const rawValue = value === null || value === undefined ? "" : String(value);
  const displayValue = value === null || value === undefined
    ? ""
    : precision === undefined
      ? formatNumber2(value)
      : formatFixedNumber(value, precision);

  return (
    <input
      type="text"
      inputMode="decimal"
      step={step}
      placeholder={placeholder}
      value={focused ? text : displayValue}
      disabled={disabled}
      onFocus={() => {
        setFocused(true);
        setText(precision === undefined ? rawValue : displayValue);
      }}
      onBlur={() => setFocused(false)}
      onChange={event => {
        const next = event.target.value.replace(/,/g, "");
        setText(next);
        onChange(next);
      }}
      className={className}
    />
  );
}
