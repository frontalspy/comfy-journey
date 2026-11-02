import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { readStored, writeStored } from "../../../storage";

interface StoredForm {
  workflowId: string | null;
  /** Per workflow, the raw remembered values; validated against the workflow when read. */
  values: Record<string, Record<string, unknown>>;
}

const KEY = "comfy.createForm";
const SAVE_DELAY_MS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validate(raw: unknown): StoredForm | undefined {
  if (!isRecord(raw)) return undefined;
  const values: StoredForm["values"] = {};
  if (isRecord(raw.values)) {
    for (const [id, entry] of Object.entries(raw.values)) if (isRecord(entry)) values[id] = entry;
  }
  return { workflowId: typeof raw.workflowId === "string" ? raw.workflowId : null, values };
}

interface CreateFormState {
  workflowId: string | null;
  rememberedValues: (workflowId: string) => Record<string, unknown> | undefined;
  selectWorkflow: (workflowId: string) => void;
  setValue: (workflowId: string, paramId: string, value: unknown) => void;
  /** Replaces a workflow's remembered values and selects it ("reuse settings"). */
  replaceValues: (workflowId: string, values: Record<string, unknown>) => void;
}

const CreateFormContext = createContext<CreateFormState | null>(null);

/** Lives above the router so the prompt and settings survive moving between screens. */
export function CreateFormProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<StoredForm>(
    () => readStored(KEY, validate) ?? { workflowId: null, values: {} },
  );

  useEffect(() => {
    const timer = setTimeout(() => writeStored(KEY, form), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form]);

  const selectWorkflow = useCallback((workflowId: string) => {
    setForm((current) => ({ ...current, workflowId }));
  }, []);

  const setValue = useCallback((workflowId: string, paramId: string, value: unknown) => {
    setForm((current) => ({
      ...current,
      values: {
        ...current.values,
        [workflowId]: { ...current.values[workflowId], [paramId]: value },
      },
    }));
  }, []);

  const replaceValues = useCallback((workflowId: string, values: Record<string, unknown>) => {
    setForm((current) => ({ workflowId, values: { ...current.values, [workflowId]: values } }));
  }, []);

  const state = useMemo<CreateFormState>(
    () => ({
      workflowId: form.workflowId,
      rememberedValues: (workflowId) => form.values[workflowId],
      selectWorkflow,
      setValue,
      replaceValues,
    }),
    [form, selectWorkflow, setValue, replaceValues],
  );

  return <CreateFormContext.Provider value={state}>{children}</CreateFormContext.Provider>;
}

export function useCreateFormState(): CreateFormState {
  const state = useContext(CreateFormContext);
  if (!state) throw new Error("useCreateFormState must be used inside CreateFormProvider");
  return state;
}
