import { app } from "../../scripts/app.js";

const extensionName = "pixora.workflow-bridge";
const workflowQueryKey = "pixoraWorkflow";
const workflowStorageKey = "pixoraEmbeddedWorkflow";
const workflowLoadedEvent = "pixora:workflow-loaded";

async function fetchWorkflowFromUserdata(relativePath) {
  const response = await fetch(`/userdata/${relativePath}`, {
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch staged workflow (${response.status})`);
  }

  return response.json();
}

async function injectWorkflowIntoComfy(workflow) {
  if (typeof app.loadApiJson === "function") {
    await app.loadApiJson(workflow);
    return true;
  }

  if (typeof app.loadGraphData === "function") {
    await app.loadGraphData(workflow);
    return true;
  }

  return false;
}

function getWorkflowPathFromLocation() {
  const url = new URL(window.location.href);
  const workflowPath = url.searchParams.get(workflowQueryKey);
  if (workflowPath) {
    window.sessionStorage.setItem(workflowStorageKey, workflowPath);
  }

  return workflowPath || window.sessionStorage.getItem(workflowStorageKey) || "";
}

function announceWorkflowLoaded(workflowPath) {
  window.dispatchEvent(
    new CustomEvent(workflowLoadedEvent, {
      detail: { workflowPath },
    }),
  );
}

async function tryLoadPixoraWorkflow(workflowPath, attempt = 0) {
  try {
    if (!workflowPath) {
      return false;
    }

    const workflow = await fetchWorkflowFromUserdata(workflowPath);
    const loaded = await injectWorkflowIntoComfy(workflow);

    if (!loaded) {
      return false;
    }

    announceWorkflowLoaded(workflowPath);
    return true;
  } catch (error) {
    if (attempt >= 20) {
      console.error(`[${extensionName}]`, error);
    }

    return false;
  }
}

function scheduleWorkflowReapply(workflowPath) {
  const retryDelays = [0, 250, 750, 1500, 3000, 5000];

  for (const delay of retryDelays) {
    window.setTimeout(() => {
      void tryLoadPixoraWorkflow(workflowPath);
    }, delay);
  }
}

async function loadPixoraWorkflow(attempt = 0) {
  const workflowPath = getWorkflowPathFromLocation();
  if (!workflowPath) {
    return;
  }

  const loaded = await tryLoadPixoraWorkflow(workflowPath, attempt);
  if (loaded) {
    scheduleWorkflowReapply(workflowPath);
    return;
  }

  if (attempt < 20) {
    window.setTimeout(() => {
      void loadPixoraWorkflow(attempt + 1);
    }, 300);
    return;
  }

  console.error(
    `[${extensionName}] ComfyUI frontend API not available for workflow injection`,
  );
}

app.registerExtension({
  name: extensionName,
  async setup() {
    window.pixoraLoadWorkflow = async () => {
      await loadPixoraWorkflow();
    };

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'pixora:load-workflow') {
        const workflowPath = event.data.workflowPath;
        if (workflowPath) {
          window.sessionStorage.setItem(workflowStorageKey, workflowPath);
          void tryLoadPixoraWorkflow(workflowPath);
        }
      }
    });

    window.requestAnimationFrame(() => {
      void loadPixoraWorkflow();
    });
  },
});
