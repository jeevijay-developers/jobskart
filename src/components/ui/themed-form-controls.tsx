import { ThemedSelect } from "@/components/ui/themed-form-controls";
("use client");

import * as React from "react";
import { CalendarDays } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type NativeLikeChangeEvent = React.ChangeEvent<HTMLSelectElement>;

type ThemedSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "multiple" | "size"
> & {
  children: React.ReactNode;
  contentClassName?: string;
};

type ParsedOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

function collectOptions(children: React.ReactNode, output: ParsedOption[] = []) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      collectOptions((child.props as { children?: React.ReactNode }).children, output);
      return;
    }
    if (child.type === "optgroup") {
      collectOptions((child.props as { children?: React.ReactNode }).children, output);
      return;
    }
    if (child.type !== "option") return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    const label = props.children;
    output.push({
      value: String(
        props.value ?? (typeof label === "string" || typeof label === "number" ? label : ""),
      ),
      label,
      disabled: props.disabled,
    });
  });
  return output;
}

/** A Radix-backed replacement for native selects, including a contained mobile menu. */
function ThemedSelect({
  children,
  value,
  defaultValue,
  onChange,
  className,
  contentClassName,
  disabled,
  name,
  id,
  required,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: ThemedSelectProps) {
  const options = React.useMemo(() => collectOptions(children), [children]);
  const placeholder = options.find((option) => option.value === "")?.label ?? "Select an option";
  const selectableOptions = options.filter((option) => option.value !== "");
  // Radix's Select treats "" as a reserved/invalid value, not "nothing
  // selected" — passing it through as a controlled value makes the trigger
  // silently keep showing the placeholder text rather than actually clearing
  // the selection, or in some cases falls back to the first item. Empty
  // string must be normalized to undefined so Radix renders the placeholder.
  const controlledValue = value == null || value === "" ? undefined : String(value);
  const initialValue = defaultValue == null ? undefined : String(defaultValue);

  const notifyChange = (nextValue: string) => {
    if (!onChange) return;
    const target = { value: nextValue, name } as HTMLSelectElement;
    onChange({ target, currentTarget: target } as NativeLikeChangeEvent);
  };

  return (
    <Select
      value={controlledValue}
      defaultValue={initialValue || undefined}
      onValueChange={notifyChange}
      disabled={disabled}
      required={required}
      name={name}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        className={cn("form-input h-10 justify-between bg-card text-left", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        position="popper"
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          "max-h-[min(17rem,var(--radix-select-content-available-height))] rounded-xl border-primary/15 bg-popover p-1 shadow-xl shadow-primary/10",
          contentClassName,
        )}
      >
        {selectableOptions.map((option, index) => (
          <SelectItem
            key={`${option.value}-${index}`}
            value={option.value}
            disabled={option.disabled}
            className="min-h-10 cursor-pointer rounded-lg px-3 pr-9 font-medium focus:bg-primary focus:text-primary-foreground data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type ThemedDatePickerProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  placeholder?: string;
};

function parseDateValue(value: string | number | readonly string[] | undefined) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** A fully themed calendar popover that never invokes the browser's native date UI. */
function ThemedDatePicker({
  value,
  defaultValue,
  onChange,
  min,
  max,
  className,
  disabled,
  name,
  id,
  placeholder = "Select date",
  required,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: ThemedDatePickerProps) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState(() => String(defaultValue ?? ""));
  const dateValue = controlled ? String(value ?? "") : internalValue;
  const selected = parseDateValue(dateValue);
  const minDate = parseDateValue(min);
  const maxDate = parseDateValue(max);
  const today = new Date();
  const lowerYear =
    minDate?.getFullYear() ?? Math.min((selected ?? today).getFullYear() - 100, 1920);
  const upperYear = maxDate?.getFullYear() ?? (selected ?? today).getFullYear() + 10;
  const initialMonth = selected ?? maxDate ?? today;
  const [month, setMonth] = React.useState(initialMonth);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (selected) setMonth(selected);
  }, [dateValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (date: Date | undefined) => {
    if (!date) return;
    const nextValue = toDateValue(date);
    if (!controlled) setInternalValue(nextValue);
    if (onChange) {
      const target = { value: nextValue, name } as HTMLInputElement;
      onChange({ target, currentTarget: target } as React.ChangeEvent<HTMLInputElement>);
    }
    setOpen(false);
  };

  const years = Array.from(
    { length: Math.max(1, upperYear - lowerYear + 1) },
    (_, i) => lowerYear + i,
  );
  const months = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(2020, i, 1)),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          aria-required={required}
          className={cn(
            "form-input flex h-10 w-full items-center justify-between bg-card text-left disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span>{selected ? formatDate(selected) : placeholder}</span>
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-[min(21rem,calc(100vw-1.5rem))] rounded-2xl border-primary/15 bg-popover p-3 shadow-2xl shadow-primary/10"
      >
        <div className="mb-2 grid grid-cols-[1fr_6.5rem] gap-2 px-1">
          <ThemedSelect
            aria-label="Month"
            value={String(month.getMonth())}
            onChange={(event) =>
              setMonth(new Date(month.getFullYear(), Number(event.target.value), 1))
            }
            className="h-9 rounded-lg"
          >
            {months.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </ThemedSelect>
          <ThemedSelect
            aria-label="Year"
            value={String(month.getFullYear())}
            onChange={(event) =>
              setMonth(new Date(Number(event.target.value), month.getMonth(), 1))
            }
            className="h-9 rounded-lg"
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </ThemedSelect>
        </div>
        <Calendar
          mode="single"
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          onSelect={commit}
          disabled={{ before: minDate, after: maxDate }}
          className="mx-auto rounded-xl bg-transparent p-1 [--cell-size:2.25rem]"
        />
      </PopoverContent>
    </Popover>
  );
}

export { ThemedDatePicker, ThemedSelect };
