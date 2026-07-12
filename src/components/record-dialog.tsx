import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil } from "lucide-react";

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "textarea" | "checkbox";
  options?: readonly string[];
  required?: boolean;
}

export function RecordDialog<T>({
  title,
  fields,
  initial,
  onSubmit,
  trigger,
}: {
  title: string;
  fields: FieldDef[];
  initial: T;
  onSubmit: (values: T) => void | Promise<void>;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<T>(initial);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const openForm = () => {
    setValues(initial);
    setError("");
    setOpen(true);
  };

  const submit = async () => {
    const missing = fields.find((field) => {
      if (!field.required) return false;
      const value = (values as Record<string, unknown>)[field.name];
      return value === null || value === undefined || String(value).trim() === "";
    });
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSubmit(values);
      setValues(initial);
      setOpen(false);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const close = () => {
    if (isSaving) return;
    setError("");
    setOpen(false);
  };

  return (
    <>
      <span className="inline-flex" onClick={openForm}>
        {trigger}
      </span>
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 py-6"
          onClick={close}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-border bg-background p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            </div>
            {error ? (
              <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}
            <div className="grid gap-4">
              {fields.map((field) => {
                const currentValue = (values as Record<string, unknown>)[field.name];
                const set = (value: unknown) =>
                  setValues((prev) => ({ ...prev, [field.name]: value }) as T);

                return (
                  <div key={field.name} className="grid gap-1.5">
                    <Label htmlFor={`${title}-${field.name}`}>{field.label}</Label>
                    {field.type === "checkbox" ? (
                      <input
                        id={`${title}-${field.name}`}
                        type="checkbox"
                        checked={Boolean(currentValue)}
                        onChange={(event) => set(event.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                    ) : field.type === "select" && field.options ? (
                      <select
                        id={`${title}-${field.name}`}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={String(currentValue ?? "")}
                        onChange={(event) => set(event.target.value)}
                      >
                        {field.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        id={`${title}-${field.name}`}
                        className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={String(currentValue ?? "")}
                        onChange={(event) => set(event.target.value)}
                      />
                    ) : (
                      <Input
                        id={`${title}-${field.name}`}
                        type={field.type ?? "text"}
                        value={String(currentValue ?? "")}
                        onChange={(event) =>
                          set(
                            field.type === "number"
                              ? Number(event.target.value)
                              : event.target.value,
                          )
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={close} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function NewButton({ label = "New" }: { label?: string }) {
  return (
    <Button>
      <Plus className="mr-1 h-4 w-4" /> {label}
    </Button>
  );
}

export function EditButton() {
  return (
    <Button variant="ghost" size="sm">
      <Pencil className="h-4 w-4" />
    </Button>
  );
}
