import { ScrollablePage } from '@/components/layout/scrollable-page';
import { useConfirmation } from '@/components/providers/confirmation-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
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
  Trash2
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ScanMode } from '../../bindings/pixora/internal/config/models';

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
    setPluginEnabled,
    trustPlugin,
    installPlugin,
    removePlugin,
    isLoading: configLoading
  } = useConfigStore();
  const { fetchImages } = useGalleryStore();
  const [newMode, setNewMode] = useState<ScanMode>(ScanMode.ScanModeNormal);
  const [isClearingIndex, setIsClearingIndex] = useState(false);
  const [isInstallingPlugin, setIsInstallingPlugin] = useState(false);
  const [logPluginFilter, setLogPluginFilter] = useState<string>('all');
  const confirm = useConfirmation();

  useEffect(() => {
    loadConfig();
    loadPlugins();
    loadPluginLogs('', 300);
  }, [loadConfig, loadPlugins, loadPluginLogs]);

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
        AllowsMultipleSelection: false
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
        'This plugin contains executable JavaScript code and will run inside the app parser runtime. Only trust plugins from sources you fully trust. Malicious plugins may compromise your data.',
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
      description: `This will delete ${pluginName} from your plugins directory and remove its trusted/enabled state.`,
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
    if (status === 'error') return 'destructive';
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
            <div className="max-w-4xl mx-auto">
              <TabsContent
                value="library"
                className="space-y-10 focus-visible:outline-none animate-in fade-in slide-in-from-right-2 duration-300"
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
                          value={
                            newMode.charAt(0).toUpperCase() + newMode.slice(1)
                          }
                          onValueChange={(v) => {
                            if (v == null) return;
                            setNewMode(
                              (v.charAt(0).toLowerCase() +
                                v.slice(1)) as ScanMode
                            );
                          }}
                        >
                          <SelectTrigger className="w-30">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ScanMode.ScanModeNormal}>
                              Normal
                            </SelectItem>
                            <SelectItem value={ScanMode.ScanModeWalk}>
                              Walk Array
                            </SelectItem>
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
                className="space-y-10 focus-visible:outline-none animate-in fade-in slide-in-from-right-2 duration-300"
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
                    <Button
                      onClick={handleInstallPlugin}
                      size="sm"
                      className="gap-2"
                      disabled={isInstallingPlugin}
                    >
                      <Plug size={16} />
                      {isInstallingPlugin ? 'Installing...' : 'Install Plugin'}
                    </Button>
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
                          only from trusted sources. New plugins start as
                          untrusted until you explicitly trust them.
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
                                  This plugin is untrusted and cannot run until
                                  you explicitly trust it.
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
                value="advanced"
                className="space-y-10 focus-visible:outline-none animate-in fade-in slide-in-from-right-2 duration-300"
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
                  className="space-y-10 focus-visible:outline-none animate-in fade-in slide-in-from-right-2 duration-300"
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
                          onValueChange={(v) => setLogPluginFilter(v)}
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">all</SelectItem>
                            {plugins.map((plugin) => (
                              <SelectItem key={plugin.id} value={plugin.id}>
                                {plugin.id}
                              </SelectItem>
                            ))}
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
                        <div className="max-h-[300px] overflow-auto bg-black/90">
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
