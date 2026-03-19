import { ScrollablePage } from '@/components/layout/scrollable-page';
import { useConfirmation } from '@/components/providers/confirmation-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/config-store';
import { useGalleryStore } from '@/stores/gallery-store';
import { Dialogs } from '@wailsio/runtime';
import {
  AlertTriangle,
  Bug,
  Cpu,
  Database,
  Eraser,
  Folder,
  FolderPlus,
  Plug,
  RefreshCw,
  ShieldAlert,
  Terminal,
  Trash2,
  WandSparkles
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AutocompleteConfig,
  PromptFormatConfig,
  ScanMode
} from '../../bindings/pixora/internal/config/models';
import { GetAutocompleteSources } from '../../bindings/pixora/internal/services/generationservice';

const defaultAutocompleteConfig = new AutocompleteConfig({
  enabled: false,
  source: '',
  suffix: '',
  matchMode: 'prefix',
  spacingMode: 'underscore',
  sortMode: 'popularity',
  whitespace: false,
  escapeParens: false,
  suggestionCap: 12
});

const defaultPromptFormatConfig = new PromptFormatConfig({
  collapseMultiline: true,
  collapseWhitespace: true,
  commaSpacingMode: 'single'
});

export default function SettingsPage() {
  const {
    config,
    loadConfig,
    plugins,
    pluginsLoading,
    pluginLogs,
    pluginLogsLoading,
    loadPlugins,
    loadPluginLogs,
    clearPluginLogs,
    addFolder,
    removeFolder,
    clearIndexAndReindex,
    setDevMode,
    setAutocompleteConfig,
    setPromptFormatConfig,
    setPluginEnabled,
    trustPlugin,
    installPlugin,
    removePlugin,
    isLoading: configLoading
  } = useConfigStore();
  const fetchImages = useGalleryStore((state) => state.fetchImages);
  const [newMode, setNewMode] = useState<ScanMode>(ScanMode.ScanModeNormal);
  const [isClearingIndex, setIsClearingIndex] = useState(false);
  const [isInstallingPlugin, setIsInstallingPlugin] = useState(false);
  const [logPluginFilter, setLogPluginFilter] = useState<string>('all');
  const [autocompleteSources, setAutocompleteSources] = useState<string[]>([]);
  const [autocompleteSourceError, setAutocompleteSourceError] =
    useState<string>('');
  const [isAutocompleteSaving, setIsAutocompleteSaving] = useState(false);
  const [isPromptFormatSaving, setIsPromptFormatSaving] = useState(false);
  const confirm = useConfirmation();

  useEffect(() => {
    loadConfig();
    loadPlugins();
    loadPluginLogs('', 300);

    const loadAutocompleteSources = async () => {
      try {
        const sources = await GetAutocompleteSources();
        setAutocompleteSources(sources);
        setAutocompleteSourceError('');
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Failed to load completion sources.';
        setAutocompleteSources([]);
        setAutocompleteSourceError(message);
      }
    };

    void loadAutocompleteSources();
  }, [loadConfig, loadPlugins, loadPluginLogs]);

  const autocompleteConfig = config?.autocomplete ?? defaultAutocompleteConfig;
  const promptFormatConfig = config?.promptFormat ?? defaultPromptFormatConfig;

  const applyAutocompletePatch = async (
    patch: Partial<AutocompleteConfig>
  ): Promise<void> => {
    if (!config) {
      return;
    }

    setIsAutocompleteSaving(true);
    try {
      const nextConfig = new AutocompleteConfig({
        ...autocompleteConfig,
        ...patch
      });
      await setAutocompleteConfig(nextConfig);
    } catch (error) {
      console.error('Failed to save autocomplete config', error);
    } finally {
      setIsAutocompleteSaving(false);
    }
  };

  const applyPromptFormatPatch = async (
    patch: Partial<PromptFormatConfig>
  ): Promise<void> => {
    if (!config) {
      return;
    }

    setIsPromptFormatSaving(true);
    try {
      const nextConfig = new PromptFormatConfig({
        ...promptFormatConfig,
        ...patch
      });
      await setPromptFormatConfig(nextConfig);
    } catch (error) {
      console.error('Failed to save prompt format config', error);
    } finally {
      setIsPromptFormatSaving(false);
    }
  };

  const handleAddFolderClick = async () => {
    try {
      const selection = await Dialogs.OpenFile({
        Title: 'Select Folder to Watch',
        CanChooseDirectories: true,
        CanChooseFiles: false,
        AllowsMultipleSelection: false
      });

      if (selection) {
        await addFolder(
          typeof selection === 'string' ? selection : selection[0],
          newMode
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearIndexingClick = async () => {
    const ok = await confirm.confirm({
      title: 'Clear Indexing Data?',
      description:
        'This will delete all indexed image records and thumbnail cache, then start indexing again from watched folders. This action cannot be undone.',
      confirmText: 'Clear & Re-index',
      cancelText: 'Cancel',
      variant: 'destructive'
    });

    if (!ok) return;

    setIsClearingIndex(true);
    try {
      await clearIndexAndReindex();
      await fetchImages(true);
    } catch (e) {
      console.error('Failed to reset indexing', e);
    } finally {
      setIsClearingIndex(false);
    }
  };

  const handleInstallPlugin = async () => {
    try {
      const selection = await Dialogs.OpenFile({
        Title: 'Select Parser Plugin (.zip)',
        CanChooseDirectories: false,
        CanChooseFiles: true,
        AllowsMultipleSelection: false,
        Filters: [
          {
            DisplayName: 'Zip Archives',
            Pattern: '*.zip'
          }
        ]
      });

      if (!selection) return;

      const zipPath = typeof selection === 'string' ? selection : selection[0];
      if (!zipPath) return;

      setIsInstallingPlugin(true);
      await installPlugin(zipPath);
      await loadPlugins();
    } catch (e) {
      console.error('Failed to install plugin', e);
    } finally {
      setIsInstallingPlugin(false);
    }
  };

  const handleTrustPlugin = async (pluginID: string) => {
    const ok = await confirm.confirm({
      title: 'Trust This Plugin?',
      description:
        'This plugin contains executable JavaScript code and will run inside the app parser runtime. Only trust plugins from sources you fully trust.',
      confirmText: 'I Trust This Plugin',
      cancelText: 'Cancel',
      variant: 'destructive'
    });

    if (!ok) return;
    await trustPlugin(pluginID);
    await loadPlugins();
  };

  const handleTogglePlugin = async (pluginID: string, enabled: boolean) => {
    try {
      await setPluginEnabled(pluginID, enabled);
      await loadPlugins();
    } catch (e) {
      console.error('Failed to toggle plugin', e);
    }
  };

  const handleRemovePlugin = async (pluginID: string, pluginName: string) => {
    const ok = await confirm.confirm({
      title: 'Remove Plugin?',
      description: `This will delete ${pluginName} from your plugins directory.`,
      confirmText: 'Remove Plugin',
      cancelText: 'Cancel',
      variant: 'destructive'
    });

    if (!ok) return;
    await removePlugin(pluginID);
    await loadPlugins();
  };

  const pluginBadgeVariant = (status: string) => {
    if (status === 'enabled') return 'default';
    if (status === 'error' || status === 'untrusted') return 'destructive';
    return 'outline';
  };

  const refreshPluginLogs = async () => {
    await loadPluginLogs(logPluginFilter === 'all' ? '' : logPluginFilter, 300);
  };

  const handleClearPluginLogs = async () => {
    await clearPluginLogs();
  };

  return (
    <div className="h-full w-full overflow-hidden">
      <div className="flex h-full overflow-hidden">
        <Tabs
          defaultValue="library"
          orientation="vertical"
          className="w-full flex h-full"
        >
          <aside className="w-64 border-r border-border/50 bg-muted/10 flex flex-col p-4 shrink-0 overflow-y-auto">
            <div className="mb-8 px-2">
              <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            </div>

            <TabsList className="bg-transparent flex flex-col gap-1.5 h-auto items-stretch p-0">
              <TabsTrigger
                value="library"
                className="justify-start gap-3 px-3 py-2.5 h-auto w-full text-left"
              >
                <Database size={16} />
                <span className="font-medium">Library</span>
              </TabsTrigger>
              <TabsTrigger
                value="plugins"
                className="justify-start gap-3 px-3 py-2.5 h-auto w-full text-left"
              >
                <Plug size={16} />
                <span className="font-medium">Plugins</span>
              </TabsTrigger>
              <TabsTrigger
                value="generation"
                className="justify-start gap-3 px-3 py-2.5 h-auto w-full text-left"
              >
                <WandSparkles size={16} />
                <span className="font-medium">Generation</span>
              </TabsTrigger>
              <TabsTrigger
                value="advanced"
                className="justify-start gap-3 px-3 py-2.5 h-auto w-full text-left"
              >
                <Cpu size={16} />
                <span className="font-medium">Advanced</span>
              </TabsTrigger>

              {config?.devMode && (
                <>
                  <div className="h-px bg-border/50 my-2 mx-2" />
                  <TabsTrigger
                    value="logs"
                    className="justify-start gap-3 px-3 py-2.5 h-auto w-full text-left"
                  >
                    <Terminal size={16} />
                    <span className="font-medium text-xs">Developer Logs</span>
                  </TabsTrigger>
                </>
              )}
            </TabsList>
          </aside>

          <ScrollablePage
            containerClassName="flex-1"
            className="p-8 lg:p-12 custom-scrollbar"
          >
            <div className="container mx-auto">
              <TabsContent
                value="library"
                className="space-y-10 focus-visible:outline-none"
              >
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold tracking-tight">Library</h2>
                  <p className="text-muted-foreground">
                    Manage your watched folders and image indexing.
                  </p>
                </div>

                <div className="space-y-8">
                  {/* Watched Folders Section */}
                  <section className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div>
                        <h3 className="font-semibold text-lg">
                          Watched Folders
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Directories currently being scanned for images.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Select
                          value={newMode}
                          onValueChange={(v) => setNewMode(v as ScanMode)}
                        >
                          <SelectTrigger className="w-30">
                            <SelectValue placeholder="Mode" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup className="overflow-y-auto max-h-[40vh]">
                              <SelectItem value={ScanMode.ScanModeNormal}>
                                Normal
                              </SelectItem>
                              <SelectItem value={ScanMode.ScanModeWalk}>
                                Walk Array
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Button
                          onClick={handleAddFolderClick}
                          size="sm"
                          className="gap-2"
                        >
                          <FolderPlus size={16} />
                          Add Folder
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                      {configLoading ? (
                        <div className="p-12 text-center text-muted-foreground">
                          Loading configurations...
                        </div>
                      ) : config?.folders?.length === 0 ? (
                        <div className="p-12 text-center flex flex-col items-center justify-center text-muted-foreground bg-muted/5">
                          <Folder size={40} className="mb-4 opacity-10" />
                          <p>No watched folders configured.</p>
                          <p className="text-xs mt-1">
                            Folders added here or via Tabs will appear in this
                            list.
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-border/50">
                          {config?.folders?.map((folder) => (
                            <div
                              key={folder.path}
                              className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors"
                            >
                              <div className="flex flex-col gap-1 overflow-hidden pr-4">
                                <div className="font-medium truncate text-sm">
                                  {folder.path}
                                </div>
                                <div className="flex items-center text-xs text-muted-foreground gap-2">
                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 rounded text-[10px] uppercase font-bold',
                                      folder.scanMode === 'walk'
                                        ? 'bg-primary/10 text-primary border border-primary/20'
                                        : 'bg-muted text-muted-foreground border border-border'
                                    )}
                                  >
                                    {folder.scanMode}
                                  </span>
                                  <span>
                                    {folder.scanMode === 'walk'
                                      ? 'Recursive indexing'
                                      : 'Flat directory'}
                                  </span>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  confirm
                                    .confirm({
                                      title: 'Stop Watching Folder',
                                      description:
                                        'Are you sure? This will remove images from this folder from your gallery index.',
                                      variant: 'destructive'
                                    })
                                    .then((ok) => {
                                      if (ok) removeFolder(folder.path);
                                    })
                                }
                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Indexing Reset Section */}
                  <section className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-lg text-destructive">
                        Maintenance
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Clean up and repair your index database.
                      </p>
                    </div>
                    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="max-w-md">
                          <h4 className="font-medium text-destructive">
                            Clear Indexing Data
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            Removes indexing cache and indexed image metadata,
                            then starts a full re-index for all watched folders.
                            Use this if you encounter missing thumbnails or
                            corrupt data.
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          onClick={handleClearIndexingClick}
                          disabled={isClearingIndex}
                          className="gap-2 shrink-0"
                        >
                          <RefreshCw
                            size={16}
                            className={isClearingIndex ? 'animate-spin' : ''}
                          />
                          {isClearingIndex ? 'Clearing...' : 'Clear & Re-index'}
                        </Button>
                      </div>
                    </div>
                  </section>
                </div>
              </TabsContent>

              <TabsContent
                value="plugins"
                className="space-y-10 focus-visible:outline-none"
              >
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold tracking-tight">Plugins</h2>
                  <p className="text-muted-foreground">
                    Extend metadata parsing with JavaScript plugins in the{' '}
                    <span className="font-mono text-xs">plugins/</span>{' '}
                    directory.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <h3 className="font-semibold text-lg">
                        Installed Plugins
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={loadPlugins}
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={pluginsLoading}
                      >
                        <RefreshCw
                          size={16}
                          className={pluginsLoading ? 'animate-spin' : ''}
                        />
                      </Button>
                      <Button
                        onClick={handleInstallPlugin}
                        size="sm"
                        className="gap-2"
                        disabled={isInstallingPlugin}
                      >
                        <Plug size={16} />
                        {isInstallingPlugin
                          ? 'Installing...'
                          : 'Install Plugin'}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-border/60 bg-muted/10">
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <ShieldAlert
                          size={14}
                          className="mt-0.5 text-amber-500"
                        />
                        <p>
                          Plugins run JavaScript code inside the app. Install
                          only from trusted sources.
                        </p>
                      </div>
                    </div>

                    {pluginsLoading ? (
                      <div className="p-10 text-center text-muted-foreground">
                        Loading plugins...
                      </div>
                    ) : plugins.length === 0 ? (
                      <div className="p-12 text-center flex flex-col items-center justify-center text-muted-foreground bg-muted/5">
                        <Plug size={38} className="mb-4 opacity-20" />
                        <p>No parser plugins detected.</p>
                        <p className="text-xs mt-1">
                          Install a plugin zip or place plugin folders in
                          plugins/.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-border/50">
                        {plugins.map((plugin) => (
                          <div
                            key={plugin.id}
                            className="p-4 flex flex-col gap-3 hover:bg-muted/10 transition-colors"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <div className="font-semibold text-sm truncate">
                                    {plugin.name || plugin.id}
                                  </div>
                                  {plugin.version ? (
                                    <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">
                                      v{plugin.version}
                                    </span>
                                  ) : null}
                                  <Badge
                                    variant={pluginBadgeVariant(plugin.status)}
                                  >
                                    {plugin.status}
                                  </Badge>
                                </div>
                                {plugin.description ? (
                                  <p className="text-xs text-muted-foreground line-clamp-2">
                                    {plugin.description}
                                  </p>
                                ) : null}
                                <div className="text-[11px] text-muted-foreground">
                                  <span>
                                    Author: {plugin.author || 'Unknown'}
                                  </span>
                                  <span className="mx-2">•</span>
                                  <span className="font-mono">{plugin.id}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <Switch
                                  checked={
                                    plugin.enabled &&
                                    plugin.status === 'enabled'
                                  }
                                  disabled={
                                    !plugin.trusted || plugin.status === 'error'
                                  }
                                  onCheckedChange={(checked) =>
                                    handleTogglePlugin(plugin.id, checked)
                                  }
                                />
                                {!plugin.trusted && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground"
                                    onClick={() => handleTrustPlugin(plugin.id)}
                                  >
                                    Trust
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() =>
                                    handleRemovePlugin(
                                      plugin.id,
                                      plugin.name || plugin.id
                                    )
                                  }
                                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </div>
                            </div>

                            {plugin.status === 'untrusted' ? (
                              <div className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300 flex items-start gap-2">
                                <AlertTriangle size={14} className="mt-0.5" />
                                <span>
                                  This plugin is untrusted and cannot be
                                  enabled.
                                </span>
                              </div>
                            ) : null}

                            {plugin.error ? (
                              <div className="text-xs rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
                                {plugin.error}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent
                value="generation"
                className="space-y-10 focus-visible:outline-none"
              >
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold tracking-tight">
                    Generation
                  </h2>
                  <p className="text-muted-foreground">
                    Configure image generation behavior and prompt assistance.
                  </p>
                </div>

                <div className="space-y-6">
                  <section className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col gap-1">
                        <h3 className="font-semibold">Prompt Autocomplete</h3>
                        <p className="text-sm text-muted-foreground max-w-2xl">
                          Suggest tags while typing in generation prompts using
                          a CSV source from{' '}
                          <span className="font-mono">data/completion</span>.
                        </p>
                      </div>
                      <Switch
                        checked={autocompleteConfig.enabled}
                        onCheckedChange={(checked) =>
                          void applyAutocompletePatch({ enabled: checked })
                        }
                        disabled={!config || isAutocompleteSaving}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Source
                        </p>
                        <Select
                          value={autocompleteConfig.source}
                          onValueChange={(value) =>
                            void applyAutocompletePatch({ source: value })
                          }
                          disabled={autocompleteSources.length === 0}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select completion source" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {autocompleteSources.map((source) => (
                                <SelectItem key={source} value={source}>
                                  {source}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {autocompleteSourceError ? (
                          <p className="text-xs text-destructive">
                            {autocompleteSourceError}
                          </p>
                        ) : null}
                        {autocompleteSources.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No CSV files found in data/completion.
                          </p>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Suffix
                        </p>
                        <Input
                          value={autocompleteConfig.suffix}
                          onChange={(event) =>
                            void applyAutocompletePatch({
                              suffix: event.target.value
                            })
                          }
                          placeholder=", "
                        />
                        <p className="text-xs text-muted-foreground">
                          Optional text appended after inserting a suggestion.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Match Mode
                        </p>
                        <Select
                          value={autocompleteConfig.matchMode}
                          onValueChange={(value) =>
                            void applyAutocompletePatch({ matchMode: value })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="prefix">Prefix</SelectItem>
                              <SelectItem value="contains">Contains</SelectItem>
                              <SelectItem value="fuzzy">Fuzzy</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Spacing Mode
                        </p>
                        <Select
                          value={autocompleteConfig.spacingMode}
                          onValueChange={(value) =>
                            void applyAutocompletePatch({ spacingMode: value })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="underscore">
                                Keep underscore
                              </SelectItem>
                              <SelectItem value="space">
                                Convert to spaces
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Sort Mode
                        </p>
                        <Select
                          value={autocompleteConfig.sortMode}
                          onValueChange={(value) =>
                            void applyAutocompletePatch({ sortMode: value })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="popularity">
                                Popularity
                              </SelectItem>
                              <SelectItem value="alphabetical">
                                Alphabetical
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Suggestion Limit
                        </p>
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          value={autocompleteConfig.suggestionCap}
                          onChange={(event) => {
                            const parsed = Number.parseInt(
                              event.target.value,
                              10
                            );
                            if (Number.isNaN(parsed)) {
                              return;
                            }
                            const clamped = Math.min(50, Math.max(1, parsed));
                            void applyAutocompletePatch({
                              suggestionCap: clamped
                            });
                          }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border/60 pt-4">
                      <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">
                            Whitespace Match
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Treat spaces as underscores while matching.
                          </p>
                        </div>
                        <Switch
                          checked={autocompleteConfig.whitespace}
                          onCheckedChange={(checked) =>
                            void applyAutocompletePatch({ whitespace: checked })
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">
                            Escape Parentheses
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Insert tags as \( and \) when needed.
                          </p>
                        </div>
                        <Switch
                          checked={autocompleteConfig.escapeParens}
                          onCheckedChange={(checked) =>
                            void applyAutocompletePatch({
                              escapeParens: checked
                            })
                          }
                        />
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-semibold">Prompt Formatting</h3>
                      <p className="text-sm text-muted-foreground max-w-2xl">
                        Configure how the Format button cleans up positive prompts.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">
                            Collapse Multiline
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Replace line breaks with spaces.
                          </p>
                        </div>
                        <Switch
                          checked={promptFormatConfig.collapseMultiline}
                          onCheckedChange={(checked) =>
                            void applyPromptFormatPatch({
                              collapseMultiline: checked
                            })
                          }
                          disabled={isPromptFormatSaving}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
                        <div>
                          <p className="text-sm font-medium">
                            Collapse Whitespace
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Reduce repeated spaces and tabs.
                          </p>
                        </div>
                        <Switch
                          checked={promptFormatConfig.collapseWhitespace}
                          onCheckedChange={(checked) =>
                            void applyPromptFormatPatch({
                              collapseWhitespace: checked
                            })
                          }
                          disabled={isPromptFormatSaving}
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Comma Spacing
                        </p>
                        <Select
                          value={promptFormatConfig.commaSpacingMode}
                          onValueChange={(value) =>
                            void applyPromptFormatPatch({
                              commaSpacingMode: value
                            })
                          }
                          disabled={isPromptFormatSaving}
                        >
                          <SelectTrigger className="w-full md:max-w-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="single">
                                Single space after comma
                              </SelectItem>
                              <SelectItem value="none">
                                No space after comma
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </section>
                </div>
              </TabsContent>

              <TabsContent
                value="advanced"
                className="space-y-10 focus-visible:outline-none"
              >
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold tracking-tight">
                    Advanced
                  </h2>
                  <p className="text-muted-foreground">
                    Developer tools and diagnostic settings.
                  </p>
                </div>

                <div className="space-y-6">
                  {/* Developer Settings Section */}
                  <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col gap-1">
                        <h3 className="font-semibold">Developer Mode</h3>
                        <p className="text-sm text-muted-foreground max-w-md">
                          Enables internal developer tools and additional
                          logging. When on, pressing{' '}
                          <kbd className="font-sans px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] font-medium">
                            F12
                          </kbd>{' '}
                          will open browser developer tools.
                        </p>
                      </div>
                      <Switch
                        checked={config?.devMode || false}
                        onCheckedChange={(checked) => setDevMode(checked)}
                      />
                    </div>
                  </section>
                </div>
              </TabsContent>

              {config?.devMode && (
                <TabsContent
                  value="logs"
                  className="space-y-10 focus-visible:outline-none"
                >
                  <div className="space-y-1">
                    <h2 className="text-2xl font-bold tracking-tight">
                      Developer Logs
                    </h2>
                    <p className="text-muted-foreground">
                      Real-time runtime logs from the plugin system.
                    </p>
                  </div>

                  {/* Plugin Developer Console */}
                  <section className="space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div>
                        <h3 className="font-semibold text-lg">
                          Plugin Console
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={logPluginFilter}
                          onValueChange={(v) => setLogPluginFilter(v ?? 'all')}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Filter by plugin" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup className="overflow-y-auto max-h-40vh">
                              <SelectItem value="all">all</SelectItem>
                              {plugins.map((plugin) => (
                                <SelectItem key={plugin.id} value={plugin.id}>
                                  {plugin.id}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={refreshPluginLogs}
                          disabled={pluginLogsLoading}
                        >
                          <RefreshCw
                            size={14}
                            className={pluginLogsLoading ? 'animate-spin' : ''}
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-2 text-muted-foreground"
                          onClick={handleClearPluginLogs}
                        >
                          <Eraser size={14} />
                          Clear
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                      <div className="px-4 py-2 border-b border-border/60 bg-muted/10 text-xs text-muted-foreground flex items-center gap-2">
                        <Bug size={13} />
                        <span>
                          Showing up to 300 recent entries
                          {logPluginFilter !== 'all'
                            ? ` for ${logPluginFilter}`
                            : ''}
                          .
                        </span>
                      </div>

                      {pluginLogsLoading ? (
                        <div className="p-10 text-center text-muted-foreground">
                          Loading plugin logs...
                        </div>
                      ) : pluginLogs.length === 0 ? (
                        <div className="p-10 text-center text-muted-foreground bg-muted/5">
                          No plugin logs yet.
                        </div>
                      ) : (
                        <div className="max-h-75 overflow-auto bg-black/90">
                          <div className="divide-y divide-white/5 font-mono text-[11px] py-1">
                            {pluginLogs.map((entry, idx) => (
                              <div
                                key={`${entry.timestamp}-${idx}`}
                                className="px-3 py-1.5 flex gap-3 hover:bg-white/5"
                              >
                                <span className="text-zinc-500 shrink-0 select-none">
                                  {entry.timestamp.split('T')[1].split('.')[0]}
                                </span>
                                <span
                                  className={cn(
                                    'shrink-0 font-bold uppercase w-10 select-none',
                                    entry.level === 'error'
                                      ? 'text-red-400'
                                      : entry.level === 'warn'
                                        ? 'text-amber-400'
                                        : 'text-emerald-400'
                                  )}
                                >
                                  {entry.level}
                                </span>
                                <span className="text-sky-400 shrink-0 select-none">
                                  [{entry.pluginID}]
                                </span>
                                <span className="text-zinc-100 break-all whitespace-pre-wrap">
                                  {entry.message}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                </TabsContent>
              )}
            </div>
          </ScrollablePage>
        </Tabs>
      </div>
    </div>
  );
}
