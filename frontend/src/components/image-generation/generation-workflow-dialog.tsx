import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  ArrowRight,
  Copy,
  GitBranch,
  Loader2,
  RefreshCw,
  Workflow,
  X
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

interface GenerationWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowJSON: string;
  isLoading: boolean;
  onRefresh: () => void;
  comfyEmbedURL: string;
  stagedComfyWorkflowPath: string;
  stagedComfyWorkflowVersion: number;
  isComfyEmbedLoading: boolean;
  onReloadComfyEmbed: () => void;
  onLoadComfyWorkflow: () => void;
}

interface WorkflowPreviewPayload {
  mode?: string;
  outputDir?: string;
  resolvedSeed?: string;
  prompt?: Record<string, WorkflowNode>;
}

interface WorkflowNode {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: Record<string, unknown>;
}

interface WorkflowNodeViewModel {
  id: string;
  title: string;
  classType: string;
  inputs: Array<{ key: string; value: string }>;
  dependencies: string[];
  incoming: WorkflowConnectionViewModel[];
  outgoing: WorkflowConnectionViewModel[];
}

interface WorkflowConnectionViewModel {
  nodeID: string;
  nodeTitle: string;
  inputKey: string;
  outputIndex: number;
}

function parseWorkflowLink(
  value: unknown
): { nodeID: string; outputIndex: number } | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const [nodeID, outputIndex] = value;
  if (typeof nodeID !== 'string' || nodeID.trim() === '') {
    return null;
  }

  return {
    nodeID,
    outputIndex:
      typeof outputIndex === 'number' && Number.isFinite(outputIndex)
        ? outputIndex
        : 0
  };
}

function formatWorkflowValue(value: unknown): string {
  if (Array.isArray(value)) {
    const linkedNode = parseWorkflowLink(value);
    if (linkedNode) {
      return `Node ${linkedNode.nodeID} · output ${linkedNode.outputIndex}`;
    }

    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function formatNodeTitle(nodeID: string, node: WorkflowNode): string {
  const metaTitle = node._meta?.title;
  if (typeof metaTitle === 'string' && metaTitle.trim() !== '') {
    return metaTitle;
  }

  return `Node ${nodeID}`;
}

function sortNodeIDs(a: string, b: string): number {
  const aNumber = Number(a);
  const bNumber = Number(b);

  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }

  return a.localeCompare(b);
}

function buildNodeModels(payload: WorkflowPreviewPayload | null): {
  columns: WorkflowNodeViewModel[][];
  nodes: WorkflowNodeViewModel[];
} {
  const prompt = payload?.prompt ?? {};
  const nodeIDs = Object.keys(prompt).sort(sortNodeIDs);
  const nodeMap = new Map<string, WorkflowNodeViewModel>();

  for (const nodeID of nodeIDs) {
    const node = prompt[nodeID];
    const inputs = Object.entries(node.inputs ?? {}).map(([key, value]) => ({
      key,
      value: formatWorkflowValue(value)
    }));
    const dependencies = Array.from(
      new Set(
        Object.values(node.inputs ?? {})
          .map((value) => parseWorkflowLink(value)?.nodeID ?? null)
          .filter((value): value is string => value !== null)
      )
    );

    nodeMap.set(nodeID, {
      id: nodeID,
      title: formatNodeTitle(nodeID, node),
      classType: node.class_type ?? 'Unknown',
      inputs,
      dependencies,
      incoming: [],
      outgoing: []
    });
  }

  for (const nodeID of nodeIDs) {
    const node = prompt[nodeID];
    const targetNode = nodeMap.get(nodeID);
    if (!targetNode) {
      continue;
    }

    for (const [inputKey, inputValue] of Object.entries(node.inputs ?? {})) {
      const link = parseWorkflowLink(inputValue);
      if (!link) {
        continue;
      }

      const sourceNode = nodeMap.get(link.nodeID);
      const sourceTitle = sourceNode?.title ?? `Node ${link.nodeID}`;
      const targetTitle = targetNode.title;
      const connection: WorkflowConnectionViewModel = {
        nodeID: link.nodeID,
        nodeTitle: sourceTitle,
        inputKey,
        outputIndex: link.outputIndex
      };

      targetNode.incoming.push(connection);

      if (sourceNode) {
        sourceNode.outgoing.push({
          nodeID: nodeID,
          nodeTitle: targetTitle,
          inputKey,
          outputIndex: link.outputIndex
        });
      }
    }
  }

  const depthCache = new Map<string, number>();
  const getDepth = (nodeID: string): number => {
    const cached = depthCache.get(nodeID);
    if (cached !== undefined) {
      return cached;
    }

    const node = nodeMap.get(nodeID);
    if (!node || node.dependencies.length === 0) {
      depthCache.set(nodeID, 0);
      return 0;
    }

    const depth =
      Math.max(
        ...node.dependencies.map((dependencyID) => {
          if (!nodeMap.has(dependencyID) || dependencyID === nodeID) {
            return 0;
          }

          return getDepth(dependencyID) + 1;
        })
      ) || 0;

    depthCache.set(nodeID, depth);
    return depth;
  };

  const columns: WorkflowNodeViewModel[][] = [];
  const nodes = Array.from(nodeMap.values()).sort((left, right) =>
    sortNodeIDs(left.id, right.id)
  );

  for (const node of nodes) {
    const depth = getDepth(node.id);
    columns[depth] ??= [];
    columns[depth].push(node);
  }

  return { columns, nodes };
}

export function GenerationWorkflowDialog({
  open,
  onOpenChange,
  workflowJSON,
  isLoading,
  onRefresh,
  comfyEmbedURL,
  stagedComfyWorkflowPath,
  stagedComfyWorkflowVersion,
  isComfyEmbedLoading,
  onReloadComfyEmbed,
  onLoadComfyWorkflow
}: GenerationWorkflowDialogProps) {
  const [activeTab, setActiveTab] = React.useState('graph');
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const hasAutoRequestedComfyEmbedRef = React.useRef(false);
  const lastPostedWorkflowVersionRef = React.useRef(0);
  const payload = React.useMemo(() => {
    if (workflowJSON.trim() === '') {
      return null;
    }

    try {
      return JSON.parse(workflowJSON) as WorkflowPreviewPayload;
    } catch {
      return null;
    }
  }, [workflowJSON]);

  const { columns, nodes } = React.useMemo(
    () => buildNodeModels(payload),
    [payload]
  );

  const handleCopy = async () => {
    if (workflowJSON.trim() === '') {
      return;
    }

    try {
      await navigator.clipboard.writeText(workflowJSON);
      toast.success('Workflow JSON copied.');
    } catch {
      toast.error('Failed to copy workflow JSON.');
    }
  };

  React.useEffect(() => {
    if (open) {
      setActiveTab('graph');
      hasAutoRequestedComfyEmbedRef.current = false;
    }
  }, [open]);

  const postWorkflowToComfy = React.useCallback((workflowPath: string) => {
    if (workflowPath.trim() === '' || !iframeRef.current?.contentWindow) {
      return;
    }

    iframeRef.current.contentWindow.postMessage(
      {
        type: 'pixora:load-workflow',
        workflowPath
      },
      '*'
    );
  }, []);

  React.useEffect(() => {
    if (!open || activeTab !== 'comfyui') {
      return;
    }
    if (comfyEmbedURL !== '' || isComfyEmbedLoading) {
      return;
    }
    if (hasAutoRequestedComfyEmbedRef.current) {
      return;
    }

    hasAutoRequestedComfyEmbedRef.current = true;
    onLoadComfyWorkflow();
  }, [
    open,
    activeTab,
    comfyEmbedURL,
    isComfyEmbedLoading,
    onLoadComfyWorkflow
  ]);

  React.useEffect(() => {
    if (!open || activeTab !== 'comfyui') {
      return;
    }
    if (!stagedComfyWorkflowPath || !iframeRef.current?.contentWindow) {
      return;
    }
    if (stagedComfyWorkflowVersion <= lastPostedWorkflowVersionRef.current) {
      return;
    }

    lastPostedWorkflowVersionRef.current = stagedComfyWorkflowVersion;
    postWorkflowToComfy(stagedComfyWorkflowPath);
  }, [
    open,
    activeTab,
    stagedComfyWorkflowPath,
    stagedComfyWorkflowVersion,
    postWorkflowToComfy
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex flex-col min-w-[min(96vw,1200px)] max-w-[1200px] h-[86vh] gap-0 p-0 overflow-hidden"
      >
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <DialogHeader className="border-b border-border/60 px-6 pt-6 pb-4 pr-4">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                    <Workflow className="size-4" />
                    Resolved ComfyUI Workflow
                  </DialogTitle>
                  <DialogDescription>
                    Visualizes the exact txt2img graph generated from the current
                    page settings.
                  </DialogDescription>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
                    </Badge>
                    {payload?.mode ? (
                      <Badge variant="outline">{payload.mode}</Badge>
                    ) : null}
                    {payload?.resolvedSeed ? (
                      <Badge variant="outline">Seed {payload.resolvedSeed}</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopy}
                      disabled={workflowJSON.trim() === ''}
                      className="gap-2"
                    >
                      <Copy className="size-4" />
                      Copy JSON
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRefresh}
                      disabled={isLoading}
                      className="gap-2"
                    >
                      {isLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Refresh
                    </Button>
                  </div>
                  <DialogClose asChild>
                    <Button variant="ghost" size="icon-sm" className="shrink-0">
                      <X className="size-4" />
                      <span className="sr-only">Close</span>
                    </Button>
                  </DialogClose>
                </div>
              </div>
              <TabsList>
                <TabsTrigger value="graph">Graph</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
                <TabsTrigger value="comfyui">ComfyUI</TabsTrigger>
              </TabsList>
            </div>
          </DialogHeader>
          <TabsContent
            value="graph"
            className="m-0 min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
          >
            <ScrollArea className="flex-1 min-h-0">
              {isLoading ? (
                <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Building workflow preview...
                </div>
              ) : nodes.length === 0 ? (
                <div className="flex h-[60vh] items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  Workflow preview unavailable.
                </div>
              ) : (
                <div className="min-w-max px-6 py-6">
                  <div className="flex items-start gap-6">
                    {columns.map((column, columnIndex) => (
                      <div
                        key={columnIndex}
                        className="w-72 shrink-0 space-y-4"
                      >
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                          <GitBranch className="size-3.5" />
                          Stage {columnIndex + 1}
                        </div>
                        {column.map((node) => (
                          <section
                            key={node.id}
                            className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm"
                          >
                            <div className="space-y-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold leading-tight">
                                    {node.title}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {node.classType}
                                  </p>
                                </div>
                                <Badge variant="outline">#{node.id}</Badge>
                              </div>

                              {node.dependencies.length > 0 ? (
                                <div className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                                  Depends on{' '}
                                  {node.dependencies
                                    .map((dependencyID) => `#${dependencyID}`)
                                    .join(', ')}
                                </div>
                              ) : (
                                <div className="rounded-xl bg-primary/5 px-3 py-2 text-xs text-primary/80">
                                  Source node
                                </div>
                              )}
                            </div>

                            <div className="mt-4 space-y-3">
                              {node.incoming.length > 0 ? (
                                <div className="rounded-xl border border-border/50 bg-background/50 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    Receives From
                                  </p>
                                  <div className="mt-2 space-y-2">
                                    {node.incoming.map((connection, index) => (
                                      <div
                                        key={`${node.id}-incoming-${connection.nodeID}-${connection.inputKey}-${index}`}
                                        className="rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-foreground/85"
                                      >
                                        <div className="flex items-center gap-1.5 font-medium">
                                          <span>#{connection.nodeID}</span>
                                          <ArrowRight className="size-3 text-muted-foreground" />
                                          <span>{connection.inputKey}</span>
                                        </div>
                                        <p className="mt-1 text-muted-foreground">
                                          {connection.nodeTitle} output{' '}
                                          {connection.outputIndex} wires into
                                          this node&apos;s {connection.inputKey}{' '}
                                          input
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              {node.outgoing.length > 0 ? (
                                <div className="rounded-xl border border-border/50 bg-background/50 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    Wires Into
                                  </p>
                                  <div className="mt-2 space-y-2">
                                    {node.outgoing.map((connection, index) => (
                                      <div
                                        key={`${node.id}-outgoing-${connection.nodeID}-${connection.inputKey}-${index}`}
                                        className="rounded-lg bg-primary/5 px-2.5 py-2 text-xs text-foreground/85"
                                      >
                                        <div className="flex items-center gap-1.5 font-medium">
                                          <span>
                                            output {connection.outputIndex}
                                          </span>
                                          <ArrowRight className="size-3 text-muted-foreground" />
                                          <span>#{connection.nodeID}</span>
                                        </div>
                                        <p className="mt-1 text-muted-foreground">
                                          Feeds {connection.nodeTitle}
                                          {' · '}
                                          input {connection.inputKey}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              {node.inputs.map((input) => (
                                <div
                                  key={`${node.id}-${input.key}`}
                                  className="rounded-xl border border-border/50 bg-background/60 px-3 py-2"
                                >
                                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                    {input.key}
                                  </p>
                                  <p
                                    className={cn(
                                      'mt-1 text-xs leading-relaxed text-foreground/90 wrap-break-word',
                                      input.value.length > 120 && 'line-clamp-3'
                                    )}
                                  >
                                    {input.value}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </TabsContent>

          <TabsContent
            value="json"
            className="m-0 min-h-0 flex-1 data-[state=active]:flex data-[state=active]:flex-col"
          >
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-6 py-6">
                <div className="mb-3 text-xs text-muted-foreground">
                  {payload?.outputDir
                    ? `Output directory: ${payload.outputDir}`
                    : ''}
                </div>
                <pre className="whitespace-pre-wrap wrap-break-word rounded-2xl border border-border/60 bg-zinc-950 p-4 text-xs leading-6 text-zinc-100">
                  <code>{workflowJSON || 'Workflow preview unavailable.'}</code>
                </pre>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent
            value="comfyui"
            forceMount
            className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden data-[state=active]:flex data-[state=active]:flex-col"
          >
            <div className="flex flex-1 min-h-0 flex-col">
              <div className="border-b border-border/50 px-6 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold">Embedded ComfyUI</p>
                    <p className="text-xs text-muted-foreground">
                      Loads the staged Pixora workflow directly into the ComfyUI
                      canvas.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={onLoadComfyWorkflow}
                      disabled={isComfyEmbedLoading}
                      className="gap-2"
                    >
                      {isComfyEmbedLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Workflow className="size-4" />
                      )}
                      Load Workflow
                    </Button>
                    <Button
                      variant="outline"
                      onClick={onReloadComfyEmbed}
                      disabled={isComfyEmbedLoading}
                      className="gap-2"
                    >
                      {isComfyEmbedLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      Reload in ComfyUI
                    </Button>
                  </div>
                </div>
              </div>

              {comfyEmbedURL ? (
                <div className="min-h-0 flex-1 bg-background">
                  <iframe
                    ref={iframeRef}
                    src={comfyEmbedURL}
                    title="Embedded ComfyUI"
                    className="block h-full w-full border-0 bg-background"
                    onLoad={() => {
                      if (
                        activeTab === 'comfyui' &&
                        stagedComfyWorkflowPath &&
                        stagedComfyWorkflowVersion >
                          lastPostedWorkflowVersionRef.current
                      ) {
                        lastPostedWorkflowVersionRef.current =
                          stagedComfyWorkflowVersion;
                        postWorkflowToComfy(stagedComfyWorkflowPath);
                      }
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center p-8">
                  <div className="max-w-md text-center">
                    <p className="text-sm font-medium">
                      ComfyUI embed is ready when you load it.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Pixora will stage the current resolved workflow and open
                      ComfyUI with that workflow injected into the canvas.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
