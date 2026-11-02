// @vitest-environment jsdom
import type { AppImage, PublicWorkflow } from "@comfy/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../../components/Toasts";
import { exampleWorkflow } from "../../../test/fixtures";
import { CreateFormProvider } from "../../create/hooks/CreateFormProvider";
import { type CreateForm, useCreateForm } from "../../create/hooks/useCreateForm";
import { SETTINGS_KEY } from "../../settings/hooks/useSettings";
import { WORKFLOWS_KEY } from "../../workflows/hooks/useWorkflows";
import { type ImageActions, useImageActions } from "./useImageActions";

afterEach(cleanup);

const other: PublicWorkflow = { ...exampleWorkflow, id: "other", name: "Other" };
const image = (workflowId: string): AppImage => ({
  id: "i1",
  jobId: "j1",
  kind: "image",
  width: 1024,
  height: 1024,
  mime: "image/png",
  bytes: 1,
  seed: 77,
  nsfw: false,
  favourite: false,
  parentImageId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  promptSummary: "a fox",
  workflowId,
  source: "generated",
  params: { prompt: "a fox in the snow", width: 640, height: 896, batch: 1, seed: -1 },
});

/** Exposes the hooks' latest results to the test. */
function Probe({ latest }: { latest: { actions?: ImageActions; form?: CreateForm } }) {
  latest.actions = useImageActions();
  latest.form = useCreateForm();
  return null;
}

function setup(options: { workflows: PublicWorkflow[]; nsfwVisible: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(WORKFLOWS_KEY, options.workflows);
  queryClient.setQueryData(SETTINGS_KEY, { nsfwVisible: options.nsfwVisible });
  const latest: { actions?: ImageActions; form?: CreateForm } = {};
  const wrapper = (children: ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <CreateFormProvider>{children}</CreateFormProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(wrapper(<Probe latest={latest} />));
  return {
    actions: () => latest.actions as ImageActions,
    form: () => latest.form as CreateForm,
  };
}

describe("reuse prompt", () => {
  it("puts the result's prompt into the prompt bar and selects its workflow", () => {
    const view = setup({ workflows: [exampleWorkflow, other], nsfwVisible: false });
    act(() => view.actions().reusePrompt(image("other")));
    expect(view.form().workflow?.id).toBe("other");
    expect(view.form().values.prompt).toBe("a fox in the snow");
  });

  it("explains why, and changes nothing, when the workflow is hidden as NSFW", () => {
    const hidden: PublicWorkflow = { ...other, nsfw: true };
    const view = setup({ workflows: [exampleWorkflow, hidden], nsfwVisible: false });
    act(() => view.actions().reusePrompt(image("other")));
    expect(view.form().workflow?.id).toBe("example");
    expect(document.body.textContent).toContain("Turn on NSFW content in Settings");
  });

  it("works for an NSFW workflow once NSFW content is shown", () => {
    const hidden: PublicWorkflow = { ...other, nsfw: true };
    const view = setup({ workflows: [exampleWorkflow, hidden], nsfwVisible: true });
    act(() => view.actions().reusePrompt(image("other")));
    expect(view.form().workflow?.id).toBe("other");
    expect(view.form().values.prompt).toBe("a fox in the snow");
  });

  it("explains an unavailable workflow instead of doing nothing", () => {
    const broken: PublicWorkflow = {
      ...other,
      available: false,
      unavailableReason: "Missing node X",
    };
    const view = setup({ workflows: [exampleWorkflow, broken], nsfwVisible: true });
    act(() => view.actions().reusePrompt(image("other")));
    expect(view.form().workflow?.id).toBe("example");
    expect(document.body.textContent).toContain("Missing node X");
  });
});

describe("reuse settings", () => {
  it("restores size and seed from the result", () => {
    const view = setup({ workflows: [exampleWorkflow], nsfwVisible: true });
    act(() => view.actions().reuseSettings(image("example")));
    expect(view.form().values).toMatchObject({ width: 640, height: 896, seed: 77 });
  });
});
