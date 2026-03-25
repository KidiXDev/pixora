import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ComfyUISetupStatus } from '@/types/image-generation';

interface ComfyUIOnboardingProps {
  setup: ComfyUISetupStatus;
  isInstalling: boolean;
  onInstall: () => void;
  onRefresh: () => void;
  onViewLogs?: () => void;
}

function describeSetupError(kind: string): string {
  switch (kind) {
    case 'permission_problem':
      return 'Pixora cannot write to this folder. Move Pixora to a normal writable directory and try again.';
    case 'download_failure':
      return 'Pixora could not download ComfyUI. Check your internet connection and retry.';
    case 'extraction_failure':
      return 'Pixora downloaded ComfyUI but could not extract it. Retry installation.';
    case 'invalid_archive_structure':
      return 'The downloaded archive did not match the expected structure. Retry installation.';
    case 'unsupported_gpu_expectation':
      return 'This installer currently targets NVIDIA GPUs.';
    case 'incomplete_installation':
      return 'A previous installation seems incomplete. Run the installer again to repair it.';
    default:
      return '';
  }
}

export function ComfyUIOnboarding({
  setup,
  isInstalling,
  onInstall,
  onRefresh,
  onViewLogs
}: ComfyUIOnboardingProps) {
  const detailError = describeSetupError(setup.errorKind);
  const canInstall = !setup.permissionProblem && !isInstalling;
  const installLabel = isInstalling
    ? 'Installing ComfyUI...'
    : setup.isInstalled && !setup.isReady
      ? 'Repair ComfyUI'
      : 'Install ComfyUI';

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 overflow-auto p-6 lg:p-10">
      <section className="rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm backdrop-blur-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          ComfyUI setup required
        </h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Pixora needs ComfyUI before image generation can be used. You do not
          need to install it manually. Pixora can download and install ComfyUI
          for you automatically into <code>backend/comfy</code>.
        </p>
        <p className="mt-2 text-sm text-amber-300/90">
          Current support: NVIDIA GPUs only.
        </p>

        <div className="mt-5 grid gap-3 text-sm text-muted-foreground">
          <p>
            <span className="text-foreground font-medium">Workspace:</span>{' '}
            {setup.workspaceRoot || '(detecting...)'}
          </p>
          <p>
            <span className="text-foreground font-medium">Status:</span>{' '}
            {setup.statusMessage || 'Checking environment...'}
          </p>
        </div>

        {(setup.lastError || detailError || setup.permissionMessage) && (
          <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-medium text-destructive">Setup needs attention</p>
            <p className="mt-2 text-foreground">
              {setup.permissionMessage || setup.lastError || detailError}
            </p>
            {detailError && detailError !== setup.lastError && (
              <p className="mt-2 text-muted-foreground">{detailError}</p>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={onInstall}
            disabled={!canInstall}
            className="min-w-44"
          >
            {isInstalling && <Spinner className="mr-2 h-4 w-4" />}
            {installLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={onRefresh}>
            Re-check environment
          </Button>
          {onViewLogs && (setup.lastError || setup.state === 'error') && (
            <Button type="button" variant="outline" onClick={onViewLogs}>
              View setup logs
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
