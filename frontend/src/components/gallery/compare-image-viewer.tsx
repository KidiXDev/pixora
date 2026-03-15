import { AnimatePresence, motion } from 'framer-motion';
import { Slider } from '@/components/ui/slider';
import { useGalleryStore } from '@/stores/gallery-store';
import { useTabsStore } from '@/stores/tabs-store';
import { Info, MoveHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageRecord } from '../../../bindings/pixora/internal/db/models';
import { Button } from '../ui/button';

type CompareSide = 'A' | 'B';

interface TokenStat {
  key: string;
  label: string;
  count: number;
  averageWeight: number | null;
}

interface WeightChange {
  key: string;
  label: string;
  fromWeight: number | null;
  toWeight: number | null;
}

interface TokenReplacement {
  from: TokenStat;
  to: TokenStat;
  score: number;
}

interface PromptDiffResult {
  added: TokenStat[];
  removed: TokenStat[];
  weightChanges: WeightChange[];
  replacements: TokenReplacement[];
  unchangedCount: number;
  totalA: number;
  totalB: number;
}

interface SettingDiffRow {
  key: string;
  label: string;
  aValue: string;
  bValue: string;
  changed: boolean;
}

interface CompareAnalysis {
  prompt: PromptDiffResult;
  negativePrompt: PromptDiffResult;
  settingRows: SettingDiffRow[];
  changedSettings: number;
}

interface ParsedPromptToken {
  base: string;
  normalized: string;
  weight: number | null;
}

function splitTopLevelPrompt(prompt: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let roundDepth = 0;
  let squareDepth = 0;
  let angleDepth = 0;

  for (const char of prompt) {
    if (char === '(') roundDepth += 1;
    if (char === ')' && roundDepth > 0) roundDepth -= 1;
    if (char === '[') squareDepth += 1;
    if (char === ']' && squareDepth > 0) squareDepth -= 1;
    if (char === '<') angleDepth += 1;
    if (char === '>' && angleDepth > 0) angleDepth -= 1;

    if (
      char === ',' &&
      roundDepth === 0 &&
      squareDepth === 0 &&
      angleDepth === 0
    ) {
      const trimmed = current.trim();
      if (trimmed) {
        tokens.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const last = current.trim();
  if (last) {
    tokens.push(last);
  }

  return tokens;
}

function normalizePromptToken(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseTrailingWeight(value: string): {
  base: string;
  weight: number | null;
} {
  const match = value.match(/^(.*?):\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) {
    return { base: value.trim(), weight: null };
  }

  return {
    base: match[1].trim(),
    weight: Number.parseFloat(match[2])
  };
}

function parsePromptToken(token: string): ParsedPromptToken {
  const trimmed = token.trim();

  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    const inner = trimmed.slice(1, -1);
    const parsed = parseTrailingWeight(inner);
    const base = parsed.base || inner;
    return {
      base,
      normalized: normalizePromptToken(base),
      weight: parsed.weight
    };
  }

  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const inner = trimmed.slice(1, -1);
    const parsed = parseTrailingWeight(inner);
    const base = parsed.base || inner;
    return {
      base,
      normalized: normalizePromptToken(base),
      weight: parsed.weight
    };
  }

  return {
    base: trimmed,
    normalized: normalizePromptToken(trimmed),
    weight: null
  };
}

function average(numbers: number[]): number | null {
  if (numbers.length === 0) {
    return null;
  }

  const total = numbers.reduce((sum, value) => sum + value, 0);
  return total / numbers.length;
}

function buildTokenStats(prompt: string): TokenStat[] {
  const map = new Map<
    string,
    { label: string; count: number; weights: number[] }
  >();

  for (const rawToken of splitTopLevelPrompt(prompt)) {
    const parsed = parsePromptToken(rawToken);
    if (!parsed.normalized) {
      continue;
    }

    const existing = map.get(parsed.normalized);
    if (!existing) {
      map.set(parsed.normalized, {
        label: parsed.base,
        count: 1,
        weights: parsed.weight === null ? [] : [parsed.weight]
      });
      continue;
    }

    existing.count += 1;
    if (parsed.weight !== null) {
      existing.weights.push(parsed.weight);
    }
  }

  return Array.from(map.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
      averageWeight: average(value.weights)
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label);
    });
}

function toWordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2)
  );
}

function diceSimilarity(left: string, right: string): number {
  const leftWords = toWordSet(left);
  const rightWords = toWordSet(right);

  if (leftWords.size === 0 && rightWords.size === 0) {
    return 1;
  }

  if (leftWords.size === 0 || rightWords.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftWords.size + rightWords.size);
}

function comparePrompts(promptA: string, promptB: string): PromptDiffResult {
  const statsA = buildTokenStats(promptA);
  const statsB = buildTokenStats(promptB);
  const mapA = new Map(statsA.map((item) => [item.key, item]));
  const mapB = new Map(statsB.map((item) => [item.key, item]));

  const added: TokenStat[] = [];
  const removed: TokenStat[] = [];
  const weightChanges: WeightChange[] = [];

  for (const itemA of statsA) {
    const itemB = mapB.get(itemA.key);
    if (!itemB) {
      removed.push(itemA);
      continue;
    }

    const sameWeight =
      itemA.averageWeight === itemB.averageWeight ||
      (itemA.averageWeight !== null &&
        itemB.averageWeight !== null &&
        Math.abs(itemA.averageWeight - itemB.averageWeight) < 0.0001);

    if (!sameWeight) {
      weightChanges.push({
        key: itemA.key,
        label: itemA.label,
        fromWeight: itemA.averageWeight,
        toWeight: itemB.averageWeight
      });
    }
  }

  for (const itemB of statsB) {
    if (!mapA.has(itemB.key)) {
      added.push(itemB);
    }
  }

  const remainingAdded = [...added];
  const remainingRemoved = [...removed];
  const replacements: TokenReplacement[] = [];

  for (const removedItem of removed) {
    let bestIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < remainingAdded.length; i += 1) {
      const candidate = remainingAdded[i];
      const score = diceSimilarity(removedItem.key, candidate.key);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestScore >= 0.45) {
      replacements.push({
        from: removedItem,
        to: remainingAdded[bestIndex],
        score: bestScore
      });

      const matchedKey = remainingAdded[bestIndex].key;
      const removeIdx = remainingRemoved.findIndex(
        (item) => item.key === removedItem.key
      );
      if (removeIdx >= 0) {
        remainingRemoved.splice(removeIdx, 1);
      }
      remainingAdded.splice(bestIndex, 1);

      const removeFromAdded = added.findIndex(
        (item) => item.key === matchedKey
      );
      if (removeFromAdded >= 0) {
        added.splice(removeFromAdded, 1);
      }
      const removeFromRemoved = removed.findIndex(
        (item) => item.key === removedItem.key
      );
      if (removeFromRemoved >= 0) {
        removed.splice(removeFromRemoved, 1);
      }
    }
  }

  const unchangedCount = statsA.filter((item) => mapB.has(item.key)).length;
  return {
    added,
    removed,
    weightChanges: weightChanges.sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    replacements: replacements.sort((left, right) => right.score - left.score),
    unchangedCount,
    totalA: statsA.length,
    totalB: statsB.length
  };
}

function compareSettings(
  firstImage: ImageRecord,
  secondImage: ImageRecord
): SettingDiffRow[] {
  const rows: SettingDiffRow[] = [
    {
      key: 'model',
      label: 'Model',
      aValue: firstImage.Model || '-',
      bValue: secondImage.Model || '-',
      changed: firstImage.Model !== secondImage.Model
    },
    {
      key: 'sampler',
      label: 'Sampler',
      aValue: firstImage.Sampler || '-',
      bValue: secondImage.Sampler || '-',
      changed: firstImage.Sampler !== secondImage.Sampler
    },
    {
      key: 'seed',
      label: 'Seed',
      aValue: firstImage.Seed || '-',
      bValue: secondImage.Seed || '-',
      changed: firstImage.Seed !== secondImage.Seed
    },
    {
      key: 'cfg',
      label: 'CFG Scale',
      aValue: String(firstImage.CfgScale),
      bValue: String(secondImage.CfgScale),
      changed: firstImage.CfgScale !== secondImage.CfgScale
    },
    {
      key: 'resolution',
      label: 'Resolution',
      aValue: `${firstImage.Width}x${firstImage.Height}`,
      bValue: `${secondImage.Width}x${secondImage.Height}`,
      changed:
        firstImage.Width !== secondImage.Width ||
        firstImage.Height !== secondImage.Height
    },
    {
      key: 'filesize',
      label: 'File Size',
      aValue: String(firstImage.FileSize),
      bValue: String(secondImage.FileSize),
      changed: firstImage.FileSize !== secondImage.FileSize
    }
  ];

  return rows;
}

function buildCompareAnalysis(
  firstImage: ImageRecord,
  secondImage: ImageRecord
): CompareAnalysis {
  const prompt = comparePrompts(
    firstImage.Prompt ?? '',
    secondImage.Prompt ?? ''
  );
  const negativePrompt = comparePrompts(
    firstImage.NegativePrompt ?? '',
    secondImage.NegativePrompt ?? ''
  );
  const settingRows = compareSettings(firstImage, secondImage);
  const changedSettings = settingRows.filter((row) => row.changed).length;

  return {
    prompt,
    negativePrompt,
    settingRows,
    changedSettings
  };
}

function formatWeight(weight: number | null): string {
  if (weight === null) {
    return '-';
  }

  return weight
    .toFixed(3)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');
}

function renderDiffToken(token: TokenStat, side: CompareSide) {
  return (
    <div
      key={`${side}-${token.key}`}
      className={`rounded-md border px-2 py-1 text-[11px] leading-snug ${
        side === 'A'
          ? 'border-rose-300/35 bg-rose-400/10 text-rose-100'
          : 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100'
      }`}
    >
      <div className="truncate">{token.label}</div>
      <div className="mt-0.5 text-[10px] opacity-80">
        x{token.count}{' '}
        {token.averageWeight !== null
          ? `| w ${formatWeight(token.averageWeight)}`
          : ''}
      </div>
    </div>
  );
}

export function CompareImageViewer() {
  const images = useGalleryStore((state) => state.images);
  const compareImageIds = useGalleryStore((state) => state.compareImageIds);
  const compareSlider = useGalleryStore((state) => state.compareSlider);
  const setCompareSlider = useGalleryStore((state) => state.setCompareSlider);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const frameRef = useRef<HTMLDivElement>(null);
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);

  useEffect(() => {
    setShowAnalysisPanel(false);
  }, [activeTabId, compareImageIds?.[0], compareImageIds?.[1]]);

  const firstImage = compareImageIds
    ? images.find((img) => img.ID === compareImageIds[0]) || null
    : null;
  const secondImage = compareImageIds
    ? images.find((img) => img.ID === compareImageIds[1]) || null
    : null;

  const analysis = useMemo(
    () =>
      firstImage && secondImage
        ? buildCompareAnalysis(firstImage, secondImage)
        : null,
    [firstImage, secondImage]
  );

  if (!compareImageIds || !firstImage || !secondImage || !analysis) return null;

  const updateFromPointerX = (clientX: number) => {
    const frame = frameRef.current;
    if (!frame) return;

    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0) return;

    const ratio = (clientX - rect.left) / rect.width;
    setCompareSlider(ratio * 100);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    updateFromPointerX(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updateFromPointerX(e.clientX);
  };

  const onImageError = (
    e: React.SyntheticEvent<HTMLImageElement, Event>,
    hash: string
  ) => {
    const target = e.currentTarget;
    if (target.src.includes('/image/')) {
      target.src = `/thumbs/${hash}.jpg`;
    }
  };

  return (
    <div className="relative h-full w-full bg-black/95">
      <div className="absolute top-0 left-0 z-40 w-full bg-linear-to-b from-black/70 to-transparent p-4">
        <div className="flex items-center justify-between gap-3 text-sm text-white/90">
          <div className="truncate max-w-[45%]">
            A: {firstImage.Path.split(/[/\\]/).pop()}
          </div>
          <MoveHorizontal size={16} className="text-white/70" />
          <div className="flex max-w-[45%] items-center justify-end gap-2">
            <div className="truncate text-right">
              B: {secondImage.Path.split(/[/\\]/).pop()}
            </div>
            <Button
              type="button"
              variant={'ghost'}
              onClick={() => setShowAnalysisPanel((prev) => !prev)}
              title={
                showAnalysisPanel ? 'Hide metadata diff' : 'Show metadata diff'
              }
              aria-label={
                showAnalysisPanel ? 'Hide metadata diff' : 'Show metadata diff'
              }
            >
              <Info size={14} />
            </Button>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 p-6 pt-16 pb-24">
        <div
          ref={frameRef}
          className="relative h-full w-full touch-none select-none overflow-hidden rounded-lg border border-white/10 bg-black"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <img
            src={`/image/?path=${encodeURIComponent(secondImage.Path)}`}
            alt="Compare image B"
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            onError={(e) => onImageError(e, secondImage.Hash)}
          />

          <img
            src={`/image/?path=${encodeURIComponent(firstImage.Path)}`}
            alt="Compare image A"
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            style={{ clipPath: `inset(0 ${100 - compareSlider}% 0 0)` }}
            onError={(e) => onImageError(e, firstImage.Hash)}
          />

          <div
            className="pointer-events-none absolute inset-y-0 z-20"
            style={{ left: `${compareSlider}%` }}
          >
            <div className="absolute -left-px top-0 h-full w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
            <div className="absolute left-0 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/50 bg-black/70 p-2 text-white shadow-lg">
              <MoveHorizontal size={14} />
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-24 left-1/2 top-16 z-30 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 md:left-auto md:right-4 md:w-96 md:translate-x-0 pointer-events-none">
        <AnimatePresence>
          {showAnalysisPanel && (
            <motion.div
              key="analysis-panel"
              initial={{ opacity: 0, scale: 0.2, y: -40, x: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, scale: 0.2, y: -40, x: 40 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black/65 shadow-2xl backdrop-blur-md pointer-events-auto"
              style={{ transformOrigin: 'top right' }}
            >
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.15em] text-white/60">
                  Metadata Diff
                </div>
                <div className="mt-1 text-sm text-white/90">
                  Prompt and settings changes from A to B
                </div>
              </div>

              <div className="h-full space-y-4 overflow-y-auto px-4 py-3 pb-28 text-white/90">
                <section className="space-y-2">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wider text-white/70">
                    <span>Main Prompt</span>
                    <span>
                      {analysis.prompt.totalA} vs {analysis.prompt.totalB} tags
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-[11px]">
                    <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                      <div className="text-white/60">Changed</div>
                      <div className="font-semibold">
                        {analysis.prompt.replacements.length}
                      </div>
                    </div>
                    <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                      <div className="text-white/60">Added</div>
                      <div className="font-semibold text-emerald-200">
                        {analysis.prompt.added.length}
                      </div>
                    </div>
                    <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                      <div className="text-white/60">Removed</div>
                      <div className="font-semibold text-rose-200">
                        {analysis.prompt.removed.length}
                      </div>
                    </div>
                    <div className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                      <div className="text-white/60">Weight</div>
                      <div className="font-semibold text-amber-200">
                        {analysis.prompt.weightChanges.length}
                      </div>
                    </div>
                  </div>

                  {analysis.prompt.replacements.length > 0 && (
                    <div className="space-y-1 rounded-md border border-white/10 bg-white/5 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-white/55">
                        Changed Into
                      </div>
                      {analysis.prompt.replacements.slice(0, 6).map((pair) => (
                        <div
                          key={`${pair.from.key}->${pair.to.key}`}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          <span className="truncate text-rose-100">
                            {pair.from.label}
                          </span>
                          <span className="text-white/50">-&gt;</span>
                          <span className="truncate text-emerald-100">
                            {pair.to.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.prompt.weightChanges.length > 0 && (
                    <div className="space-y-1 rounded-md border border-white/10 bg-white/5 p-2">
                      <div className="text-[10px] uppercase tracking-wide text-white/55">
                        Weight Changes
                      </div>
                      {analysis.prompt.weightChanges.slice(0, 6).map((change) => (
                        <div
                          key={`weight-${change.key}`}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span className="truncate">{change.label}</span>
                          <span className="text-white/65">
                            {formatWeight(change.fromWeight)} -&gt;{' '}
                            {formatWeight(change.toWeight)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(analysis.prompt.added.length > 0 ||
                    analysis.prompt.removed.length > 0) && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wide text-white/55">
                          Removed from A
                        </div>
                        <div className="space-y-1">
                          {analysis.prompt.removed
                            .slice(0, 8)
                            .map((token) => renderDiffToken(token, 'A'))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wide text-white/55">
                          Added in B
                        </div>
                        <div className="space-y-1">
                          {analysis.prompt.added
                            .slice(0, 8)
                            .map((token) => renderDiffToken(token, 'B'))}
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wider text-white/70">
                    <span>Negative Prompt</span>
                    <span>
                      {analysis.negativePrompt.replacements.length} changed
                    </span>
                  </div>
                  <div className="rounded-md border border-white/10 bg-white/5 px-2 py-2 text-[11px] text-white/80">
                    Added {analysis.negativePrompt.added.length} | Removed{' '}
                    {analysis.negativePrompt.removed.length} | Weight{' '}
                    {analysis.negativePrompt.weightChanges.length}
                  </div>
                </section>

                <section className="space-y-2">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wider text-white/70">
                    <span>Generation Settings</span>
                    <span>{analysis.changedSettings} changed</span>
                  </div>
                  <div className="space-y-1.5">
                    {analysis.settingRows.map((row) => (
                      <div
                        key={row.key}
                        className={`rounded-md border px-2 py-1.5 text-[11px] ${
                          row.changed
                            ? 'border-amber-300/35 bg-amber-300/10'
                            : 'border-white/10 bg-white/5'
                        }`}
                      >
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-white/60">
                          {row.label}
                        </div>
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <span className="truncate text-white/80">
                            {row.aValue}
                          </span>
                          <span className="text-white/45">-&gt;</span>
                          <span className="truncate text-white">
                            {row.bValue}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="absolute bottom-4 left-1/2 z-20 w-[min(560px,80%)] -translate-x-1/2 rounded-xl border border-white/10 bg-black/60 px-4 py-3 backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-white/70">
          <span>Swipe Divider</span>
          <span>{Math.round(compareSlider)}%</span>
        </div>
        <Slider
          value={[compareSlider]}
          min={0}
          max={100}
          step={1}
          onValueChange={(value) => {
            const next = Array.isArray(value) ? value[0] : value;
            if (typeof next === 'number') {
              setCompareSlider(next);
            }
          }}
        />
      </div>
    </div>
  );
}
