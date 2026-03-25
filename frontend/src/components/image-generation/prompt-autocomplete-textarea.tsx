import { Textarea } from '@/components/ui/textarea';
import { cn, formatNumber } from '@/lib/utils';
import { PromptAutocompleteSuggestion } from '@/types/image-generation';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { GetAutocompleteSuggestions } from '../../../bindings/pixora/internal/services/generationservice';

interface PromptAutocompleteTextareaProps {
  id: string;
  name: string;
  value: string;
  placeholder?: string;
  className?: string;
  ariaInvalid?: boolean;
  onBlur: () => void;
  onChange: (nextValue: string) => void;
}



interface CaretPosition {
  left: number;
  top: number;
}

interface TokenRange {
  start: number;
  end: number;
  value: string;
}

const MIRROR_STYLES = [
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'MozTabSize',
  'whiteSpace',
  'wordWrap'
] as const;

const CATEGORY_LABELS: Record<number, string> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta'
};

function PromptAutocompleteTextareaBase({
  id,
  name,
  value,
  placeholder,
  className,
  ariaInvalid,
  onBlur,
  onChange
}: PromptAutocompleteTextareaProps) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const debounceRef = React.useRef<number | null>(null);
  const caretFrameRef = React.useRef<number | null>(null);
  const requestIdRef = React.useRef(0);
  const ignoreCollapsedSelectClearRef = React.useRef(false);

  const [isFocused, setIsFocused] = React.useState(false);
  const [cursorIndex, setCursorIndex] = React.useState(0);
  const [position, setPosition] = React.useState<CaretPosition>({
    left: 8,
    top: 8
  });
  const [suggestions, setSuggestions] = React.useState<
    PromptAutocompleteSuggestion[]
  >([]);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [isMounted, setIsMounted] = React.useState(false);

  const tokenRange = React.useMemo(
    () => getTokenRange(value, cursorIndex),
    [value, cursorIndex]
  );

  const isOpen = isFocused && suggestions.length > 0;

  React.useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  const recalcCaretPosition = React.useCallback(() => {
    const textarea = textareaRef.current;
    const wrapper = wrapperRef.current;
    if (!textarea || !wrapper) {
      return;
    }

    const caret = getCaretPosition(textarea, textarea.selectionStart ?? 0);
    if (!caret) {
      return;
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const horizontalOffset = caret.left - wrapperRect.left;

    // Keep fallback position stable before first measurement, while using viewport
    // anchored coordinates for the portal popover.
    const nextLeft = Math.max(8, horizontalOffset);
    const nextTop = Math.max(8, caret.top + 6);

    setPosition((current) => {
      if (
        Math.abs(current.left - nextLeft) < 0.5 &&
        Math.abs(current.top - nextTop) < 0.5
      ) {
        return current;
      }

      return {
        left: nextLeft,
        top: nextTop
      };
    });
  }, []);

  const scheduleCaretRecalc = React.useCallback(() => {
    if (caretFrameRef.current !== null) {
      window.cancelAnimationFrame(caretFrameRef.current);
    }

    caretFrameRef.current = window.requestAnimationFrame(() => {
      caretFrameRef.current = null;
      recalcCaretPosition();
    });
  }, [recalcCaretPosition]);

  const requestSuggestions = React.useCallback((query: string) => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      void GetAutocompleteSuggestions({
        input: query,
        limit: 20
      })
        .then((result) => {
          if (requestId !== requestIdRef.current) {
            return;
          }

          const nextSuggestions = (result ??
            []) as PromptAutocompleteSuggestion[];
          setSuggestions(nextSuggestions);
          setActiveIndex(0);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          setSuggestions([]);
        });
    }, 90);
  }, []);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      requestIdRef.current += 1;
    };
  }, []);

  React.useEffect(() => {
    scheduleCaretRecalc();
  }, [cursorIndex, value, scheduleCaretRecalc]);

  React.useEffect(() => {
    const handleWindowResize = () => scheduleCaretRecalc();
    window.addEventListener('resize', handleWindowResize);
    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (caretFrameRef.current !== null) {
        window.cancelAnimationFrame(caretFrameRef.current);
      }
    };
  }, [scheduleCaretRecalc]);

  const applySuggestion = React.useCallback(
    (suggestion: PromptAutocompleteSuggestion) => {
      const insertionText = buildInsertionText(
        value,
        tokenRange.start,
        suggestion.insertText
      );

      const nextText =
        value.slice(0, tokenRange.start) +
        insertionText +
        value.slice(tokenRange.end);

      const nextCursor = tokenRange.start + insertionText.length;
      onChange(nextText);
      setSuggestions([]);
      setActiveIndex(0);

      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(nextCursor, nextCursor);
        setCursorIndex(nextCursor);
        scheduleCaretRecalc();
      });
    },
    [onChange, scheduleCaretRecalc, tokenRange.end, tokenRange.start, value]
  );

  return (
    <div ref={wrapperRef} className="relative">
      <Textarea
        ref={textareaRef}
        id={id}
        name={name}
        value={value}
        onFocus={(event) => {
          setIsFocused(true);
          setSuggestions([]);
          setActiveIndex(0);
          const nextCursor = event.currentTarget.selectionStart ?? value.length;
          setCursorIndex(nextCursor);
          scheduleCaretRecalc();
        }}
        onBlur={() => {
          setIsFocused(false);
          setSuggestions([]);
          setActiveIndex(0);
          onBlur();
        }}
        onSelect={(event) => {
          const { selectionStart, selectionEnd } = event.currentTarget;
          const nextCursor = selectionStart ?? 0;
          const hasSelection = (selectionEnd ?? 0) !== nextCursor;
          setCursorIndex(nextCursor);

          if (!hasSelection && ignoreCollapsedSelectClearRef.current) {
            ignoreCollapsedSelectClearRef.current = false;
          } else {
            setSuggestions([]);
            setActiveIndex(0);
          }

          scheduleCaretRecalc();
        }}
        onScroll={scheduleCaretRecalc}
        onKeyDown={(event) => {
          const isTypingKey =
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            (event.key.length === 1 ||
              event.key === 'Backspace' ||
              event.key === 'Delete' ||
              event.key === 'Enter');

          if (isTypingKey) {
            ignoreCollapsedSelectClearRef.current = true;
          }

          if (!isOpen) {
            return;
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % suggestions.length);
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(
              (current) =>
                (current - 1 + suggestions.length) % suggestions.length
            );
            return;
          }

          if (event.key === 'Enter' || event.key === 'Tab') {
            const selected = suggestions[activeIndex];
            if (!selected) {
              return;
            }
            event.preventDefault();
            applySuggestion(selected);
            return;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            setSuggestions([]);
          }
        }}
        onChange={(event) => {
          ignoreCollapsedSelectClearRef.current = true;
          const nextValue = event.target.value;
          onChange(nextValue);
          const nextCursor =
            event.currentTarget.selectionStart ?? nextValue.length;
          setCursorIndex(nextCursor);

          const nextToken = getTokenRange(nextValue, nextCursor).value;
          if (!isFocused || nextToken === '') {
            setSuggestions([]);
            setActiveIndex(0);
          } else {
            requestSuggestions(nextToken);
          }

          scheduleCaretRecalc();
        }}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        className={className}
      />

      {isOpen && isMounted
        ? createPortal(
            <div
              className="fixed z-9999 w-96 max-w-[calc(100vw-3rem)] overflow-hidden rounded-md border border-border bg-popover shadow-xl"
              style={{
                left: `${Math.min(
                  Math.max(8, position.left),
                  Math.max(8, window.innerWidth - 400)
                )}px`,
                top: `${Math.min(
                  Math.max(8, position.top),
                  Math.max(8, window.innerHeight - 280)
                )}px`
              }}
            >
              <div className="max-h-64 overflow-y-auto">
                {suggestions.map((suggestion, index) => {
                  const category =
                    CATEGORY_LABELS[suggestion.category] ?? 'other';
                  return (
                    <button
                      key={`${suggestion.tag}-${suggestion.popularity}-${index}`}
                      type="button"
                      className={cn(
                        'w-full px-3 py-2 text-left hover:bg-accent/60 transition-colors',
                        activeIndex === index
                          ? 'bg-accent text-accent-foreground'
                          : ''
                      )}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applySuggestion(suggestion);
                      }}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium truncate">
                          {suggestion.tag}
                        </p>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground shrink-0">
                          {category}
                        </p>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground truncate">
                          {suggestion.alternative || suggestion.matchedValue}
                        </p>
                        <p className="text-xs text-muted-foreground shrink-0">
                          {formatNumber(suggestion.popularity)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export const PromptAutocompleteTextarea = React.memo(PromptAutocompleteTextareaBase);

function getTokenRange(value: string, cursorIndex: number): TokenRange {
  const safeCursor = Math.min(Math.max(cursorIndex, 0), value.length);

  let start = safeCursor;
  while (start > 0) {
    const character = value[start - 1];
    if (character === ',' || character === '\n' || character === '\r') {
      break;
    }
    start--;
  }

  let end = safeCursor;
  while (end < value.length) {
    const character = value[end];
    if (character === ',' || character === '\n' || character === '\r') {
      break;
    }
    end++;
  }

  return {
    start,
    end,
    value: value.slice(start, end).trim()
  };
}

function buildInsertionText(
  value: string,
  tokenStart: number,
  insertText: string
): string {
  let left = tokenStart - 1;
  while (left >= 0) {
    const char = value[left];
    if (char === ' ' || char === '\t') {
      left--;
      continue;
    }
    break;
  }

  if (left >= 0 && value[left] === ',') {
    return ` ${insertText.trimStart()}`;
  }

  return insertText;
}

function getCaretPosition(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): CaretPosition | null {
  const computed = window.getComputedStyle(textarea);
  const { mirror, marker } = getMirrorElements();

  for (const property of MIRROR_STYLES) {
    mirror.style[property] =
      computed[property as keyof CSSStyleDeclaration] ?? '';
  }

  mirror.style.position = 'fixed';
  mirror.style.visibility = 'hidden';
  mirror.style.left = '-99999px';
  mirror.style.top = '0';
  mirror.style.pointerEvents = 'none';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordBreak = 'break-word';
  mirror.style.overflow = 'hidden';
  mirror.style.width = `${textarea.clientWidth}px`;

  const text = textarea.value;
  const before = text.slice(0, caretIndex);
  const after = text.slice(caretIndex) || ' ';

  mirror.textContent = before;
  marker.textContent = after[0] ?? ' ';
  mirror.appendChild(marker);

  const markerRectLeft = marker.offsetLeft;
  const markerRectTop = marker.offsetTop;
  const lineHeight = Number.parseFloat(computed.lineHeight || '16') || 16;
  const textareaRect = textarea.getBoundingClientRect();

  return {
    left: textareaRect.left + markerRectLeft - textarea.scrollLeft,
    top: textareaRect.top + markerRectTop - textarea.scrollTop + lineHeight
  };
}

let sharedMirror: HTMLDivElement | null = null;
let sharedMarker: HTMLSpanElement | null = null;

function getMirrorElements(): {
  mirror: HTMLDivElement;
  marker: HTMLSpanElement;
} {
  if (!sharedMirror || !sharedMarker) {
    sharedMirror = document.createElement('div');
    sharedMarker = document.createElement('span');
    sharedMirror.appendChild(sharedMarker);
    document.body.appendChild(sharedMirror);
  }

  return {
    mirror: sharedMirror,
    marker: sharedMarker
  };
}
