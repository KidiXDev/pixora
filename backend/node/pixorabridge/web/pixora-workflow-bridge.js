import { app } from "../../scripts/app.js";

const extensionName = "pixora.workflow-bridge";
const workflowQueryKey = "pixoraWorkflow";
const workflowLoadedEvent = "pixora:workflow-loaded";
let latestLoadRequestID = 0;

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
  const apiPrompt =
    workflow && typeof workflow === "object" && workflow.prompt
      ? workflow.prompt
      : workflow;

  if (typeof app.loadApiJson === "function") {
    await app.loadApiJson(apiPrompt);
    return true;
  }

  if (typeof app.loadGraphData === "function") {
    await app.loadGraphData(apiPrompt);
    return true;
  }

  return false;
}

function getWorkflowPathFromLocation() {
  const url = new URL(window.location.href);
  return url.searchParams.get(workflowQueryKey) || "";
}

function announceWorkflowLoaded(workflowPath) {
  window.dispatchEvent(
    new CustomEvent(workflowLoadedEvent, {
      detail: { workflowPath },
    }),
  );
}

async function tryLoadPixoraWorkflow(workflowPath, requestID, attempt = 0) {
  try {
    if (requestID !== latestLoadRequestID) {
      return false;
    }

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
    if (attempt >= 20 && requestID === latestLoadRequestID) {
      console.error(`[${extensionName}]`, error);
    }

    return false;
  }
}

async function loadPixoraWorkflow(workflowPath, requestID, attempt = 0) {
  if (requestID !== latestLoadRequestID) {
    return;
  }

  if (!workflowPath) {
    return;
  }

  const loaded = await tryLoadPixoraWorkflow(workflowPath, requestID, attempt);
  if (loaded) {
    return;
  }

  if (attempt < 20 && requestID === latestLoadRequestID) {
    window.setTimeout(() => {
      void loadPixoraWorkflow(workflowPath, requestID, attempt + 1);
    }, 300);
    return;
  }

  if (requestID === latestLoadRequestID) {
    console.error(
      `[${extensionName}] ComfyUI frontend API not available for workflow injection`,
    );
  }
}

function startWorkflowLoad(workflowPath) {
  latestLoadRequestID += 1;
  const requestID = latestLoadRequestID;
  void loadPixoraWorkflow(workflowPath, requestID, 0);
}

app.registerExtension({
  name: extensionName,
  async setup() {
    window.pixoraLoadWorkflow = async () => {
      const workflowPath = getWorkflowPathFromLocation();
      startWorkflowLoad(workflowPath);
    };

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'pixora:load-workflow') {
        const workflowPath = event.data.workflowPath;
        if (workflowPath) {
          startWorkflowLoad(workflowPath);
        }
      }
    });

    window.requestAnimationFrame(() => {
      const workflowPath = getWorkflowPathFromLocation();
      if (workflowPath) {
        startWorkflowLoad(workflowPath);
      }
    });
  },
});
