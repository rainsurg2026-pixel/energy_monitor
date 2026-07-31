import { useEffect, useState } from "react";
import { formatNumber2 } from "../utils/numberFormatBridge";

interface NumericEntryInputProps {
  value: number | null | undefined;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  disabled?: boolean;
  step?: string;
}

/** Keeps form state numeric while presenting grouped, two-decimal values at rest. */
export default function NumericEntryInput({
  value,
  onChange,
  className,
  placeholder,
  disabled = false,
  step
}: NumericEntryInputProps) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!focused) setText(value === null || value === undefined ? "" : formatNumber2(value));
  }, [focused, value]);

  const rawValue = value === null || value === undefined ? "" : String(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      step={step}
      placeholder={placeholder}
      value={focused ? text : (value === null || value === undefined ? "" : formatNumber2(value))}
      disabled={disabled}
      onFocus={() => {
        setFocused(true);
        setText(rawValue);
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
