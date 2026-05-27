import { Button } from '@/components/ui/button';
import {
  CaseSensitive,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Regex,
  Search,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GetImageRawWorkflow } from '../../../bindings/pixora/internal/services/galleryservice';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getHighlightedHtml(
  text: string,
  query: string,
  useRegex: boolean,
  matchCase: boolean,
  activeMatchIndex: number
): { html: string; matchCount: number } {
  if (!query) {
    return { html: escapeHtml(text), matchCount: 0 };
  }

  let regex: RegExp;
  try {
    const flags = matchCase ? 'g' : 'gi';
    const pattern = useRegex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (pattern === '' || pattern === '()') {
      return { html: escapeHtml(text), matchCount: 0 };
    }
    regex = new RegExp(pattern, flags);
  } catch {
    return { html: escapeHtml(text), matchCount: 0 };
  }

  const matches: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  const maxMatches = 1000;

  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= maxMatches) break;
    if (!regex.global) break;
  }

  // Normalize activeMatchIndex
  const normalizedActiveIndex =
    ((activeMatchIndex % matches.length) + matches.length) % matches.length;

  let resultHtml = '';
  let lastIndex = 0;
  matches.forEach((m, index) => {
    resultHtml += escapeHtml(text.slice(lastIndex, m.start));
    const isActive = index === normalizedActiveIndex;
    const matchClass = isActive
      ? 'bg-amber-500 text-black font-semibold rounded-[2px] px-[1px] shadow-sm'
      : 'bg-yellow-500/30 text-white rounded-[2px] px-[1px]';
    const matchId = isActive ? ' id="active-workflow-match"' : '';
    resultHtml += `<mark${matchId} class="${matchClass}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    lastIndex = m.end;
  });
  resultHtml += escapeHtml(text.slice(lastIndex));

  return { html: resultHtml, matchCount: matches.length };
}

interface RawWorkflowInspectorProps {
  imagePath: string;
  onClose: () => void;
}

export function RawWorkflowInspector({
  imagePath,
  onClose
}: RawWorkflowInspectorProps) {
  const [rawWorkflow, setRawWorkflow] = useState('');
  const [rawWorkflowError, setRawWorkflowError] = useState('');
  const [isRawWorkflowLoading, setIsRawWorkflowLoading] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [workflowHeight, setWorkflowHeight] = useState(() => {
    try {
      const saved = window.localStorage.getItem('pixora:workflow-panel-height');
      return saved ? parseInt(saved, 10) : 224;
    } catch {
      return 224;
    }
  });

  const resizableRef = useRef<HTMLDivElement>(null);

  // Fetch workflow whenever image changes
  useEffect(() => {
    if (!imagePath) return;

    let isMounted = true;
    setRawWorkflow('');
    setRawWorkflowError('');
    setIsRawWorkflowLoading(true);
    setCopiedRaw(false);
    setShowSearch(false);
    setSearchQuery('');
    setActiveMatchIndex(0);

    const fetchWorkflow = async () => {
      try {
        const result = await GetImageRawWorkflow(imagePath);
        if (!isMounted) return;

        const trimmed = (result || '').trim();
        if (!trimmed) {
          setRawWorkflowError('No raw workflow metadata found in this image.');
        } else {
          setRawWorkflow(trimmed);
        }
      } catch (err) {
        if (!isMounted) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to load raw workflow metadata.';
        setRawWorkflowError(message);
      } finally {
        if (isMounted) {
          setIsRawWorkflowLoading(false);
        }
      }
    };

    fetchWorkflow();

    return () => {
      isMounted = false;
    };
  }, [imagePath]);

  // Reset active match when search controls change
  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery, searchRegex, searchMatchCase]);

  // Handle panel height saving with ResizeObserver
  useEffect(() => {
    const element = resizableRef.current;
    if (!element) return;

    let timeoutId: number;

    const observer = new ResizeObserver(() => {
      const height = element.offsetHeight;
      if (height > 0) {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          setWorkflowHeight(height);
          try {
            window.localStorage.setItem(
              'pixora:workflow-panel-height',
              String(height)
            );
          } catch (err) {
            console.error('Failed to save workflow panel height', err);
          }
        }, 150);
      }
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeoutId);
    };
  }, []);

  // Listen for CTRL+F when raw workflow panel is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => {
          const input = document.getElementById('workflow-search-input');
          if (input) {
            (input as HTMLInputElement).focus();
            (input as HTMLInputElement).select();
          }
        }, 50);
      } else if (e.key === 'Escape' && showSearch) {
        e.preventDefault();
        setShowSearch(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSearch]);

  // Scroll active match into view
  useEffect(() => {
    if (showSearch && searchQuery) {
      const activeElem = document.getElementById('active-workflow-match');
      if (activeElem) {
        activeElem.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center'
        });
      }
    }
  }, [activeMatchIndex, searchQuery, showSearch]);

  const prettyRawWorkflow = useMemo(() => {
    const trimmed = rawWorkflow.trim();
    if (!trimmed) return '';
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return rawWorkflow;
    }
  }, [rawWorkflow]);

  const { html: highlightedContent, matchCount } = useMemo(() => {
    if (!prettyRawWorkflow) {
      return { html: '', matchCount: 0 };
    }
    return getHighlightedHtml(
      prettyRawWorkflow,
      showSearch ? searchQuery : '',
      searchRegex,
      searchMatchCase,
      activeMatchIndex
    );
  }, [
    prettyRawWorkflow,
    searchQuery,
    showSearch,
    searchRegex,
    searchMatchCase,
    activeMatchIndex
  ]);

  const handleCopyRawWorkflow = () => {
    const value = prettyRawWorkflow || rawWorkflow;
    if (!value) return;
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 1500);
  };

  return (
    <div
      className="absolute top-16 left-4 right-[calc(33.333%+1rem)] z-20 pointer-events-auto rounded-lg border border-white/20 bg-black/75 backdrop-blur-sm shadow-xl flex flex-col animate-in fade-in zoom-in-95 duration-200"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 h-10 border-b border-white/10 relative">
        <div className="text-xs font-semibold text-white/90 select-none">
          Raw Workflow JSON
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            title="Find (Ctrl+F)"
            onClick={() => {
              const nextSearch = !showSearch;
              setShowSearch(nextSearch);
              if (nextSearch) {
                setTimeout(() => {
                  const input = document.getElementById(
                    'workflow-search-input'
                  );
                  if (input) {
                    (input as HTMLInputElement).focus();
                    (input as HTMLInputElement).select();
                  }
                }, 50);
              }
            }}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
              showSearch
                ? 'border-cyan-300/50 bg-cyan-500/20 text-cyan-100'
                : 'border-white/20 text-white/90 hover:bg-white/10'
            }`}
          >
            <Search size={12} />
            Find
          </button>

          <button
            type="button"
            onClick={handleCopyRawWorkflow}
            disabled={!rawWorkflow}
            className="inline-flex items-center gap-1 rounded border border-white/20 px-2 py-0.5 text-[11px] font-medium text-white/90 disabled:opacity-50 hover:bg-white/10 transition-colors"
          >
            {copiedRaw ? <Check size={12} /> : <Copy size={12} />}
            {copiedRaw ? 'Copied' : 'Copy'}
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Close panel"
            className="text-white/60 hover:text-white p-0.5 rounded ml-1 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="absolute right-4 top-12 flex items-center gap-2 bg-zinc-950/95 border border-white/20 rounded-lg px-3 py-1.5 shadow-2xl z-30 animate-in fade-in slide-in-from-top-2 duration-150">
          <Search className="text-white/40 size-4" />
          <input
            id="workflow-search-input"
            type="text"
            placeholder="Find..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (matchCount > 0) {
                  if (e.shiftKey) {
                    setActiveMatchIndex(
                      (prev) => (prev - 1 + matchCount) % matchCount
                    );
                  } else {
                    setActiveMatchIndex((prev) => (prev + 1) % matchCount);
                  }
                }
              }
            }}
            className="bg-transparent text-white text-xs outline-hidden w-40 placeholder:text-white/30"
          />

          {searchQuery && (
            <span className="text-xs text-white/45 select-none mr-1.5 whitespace-nowrap font-medium">
              {matchCount > 0
                ? `${activeMatchIndex + 1} / ${matchCount}`
                : '0 / 0'}
            </span>
          )}

          {searchQuery && matchCount > 0 && (
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="Previous Match (Shift+Enter)"
                onClick={() =>
                  setActiveMatchIndex(
                    (prev) => (prev - 1 + matchCount) % matchCount
                  )
                }
                className="text-white/60 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
              >
                <ChevronUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="Next Match (Enter)"
                onClick={() =>
                  setActiveMatchIndex((prev) => (prev + 1) % matchCount)
                }
                className="text-white/60 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
              >
                <ChevronDown className="size-4" />
              </Button>
            </div>
          )}

          <div className="w-px h-4 bg-white/10 mx-1" />

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Match Case"
            onClick={() => setSearchMatchCase(!searchMatchCase)}
            className={`p-1 rounded transition-colors ${
              searchMatchCase
                ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/30'
                : 'text-white/60 hover:text-white border border-transparent'
            }`}
          >
            <CaseSensitive className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Use Regular Expression"
            onClick={() => setSearchRegex(!searchRegex)}
            className={`p-1 rounded transition-colors ${
              searchRegex
                ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/30'
                : 'text-white/60 hover:text-white border border-transparent'
            }`}
          >
            <Regex className="size-4" />
          </Button>

          <div className="w-px h-4 bg-white/10 mx-1" />

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setShowSearch(false)}
            className="text-white/60 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      <div
        ref={resizableRef}
        style={{ height: `${workflowHeight}px` }}
        className="min-h-24 max-h-[65vh] resize-y overflow-auto p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-white/85 select-text cursor-text"
      >
        {isRawWorkflowLoading && 'Loading raw workflow...'}
        {!isRawWorkflowLoading && rawWorkflowError && rawWorkflowError}
        {!isRawWorkflowLoading && !rawWorkflowError && (
          <code dangerouslySetInnerHTML={{ __html: highlightedContent }} />
        )}
      </div>
    </div>
  );
}
