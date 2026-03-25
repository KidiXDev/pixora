import { cn } from '@/lib/utils';
import { Tokenizer } from '@huggingface/tokenizers';
import * as React from 'react';

interface PromptTokenCounterProps {
  value: string;
  softLimit?: number;
  className?: string;
}

const TOKEN_COUNT_DEBOUNCE_MS = 120;

const TOKENIZER_BASE_PATH = '/tokenizers/openai-clip-vit-base-patch32';

let tokenizerPromise: Promise<Tokenizer> | null = null;

async function loadJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

async function getClipTokenizer(): Promise<Tokenizer> {
  if (tokenizerPromise !== null) {
    return tokenizerPromise;
  }

  tokenizerPromise = Promise.all([
    loadJson(`${TOKENIZER_BASE_PATH}/tokenizer.json`),
    loadJson(`${TOKENIZER_BASE_PATH}/tokenizer_config.json`)
  ]).then(([tokenizerJson, tokenizerConfig]) => {
    return new Tokenizer(tokenizerJson, tokenizerConfig);
  });

  return tokenizerPromise;
}

async function countPromptTokens(input: string): Promise<number> {
  const trimmed = input.trim();
  if (trimmed === '') {
    return 0;
  }

  const tokenizer = await getClipTokenizer();
  const encoding = tokenizer.encode(trimmed, {
    add_special_tokens: true
  });

  return encoding.ids.length;
}

export function PromptTokenCounter({
  value,
  softLimit = 75,
  className
}: PromptTokenCounterProps) {
  const [tokenCount, setTokenCount] = React.useState(0);
  const [hasTokenizerError, setHasTokenizerError] = React.useState(false);

  React.useEffect(() => {
    let isActive = true;
    const timeoutID = window.setTimeout(() => {
      void countPromptTokens(value)
        .then((result) => {
          if (!isActive) {
            return;
          }

          setTokenCount(result);
          setHasTokenizerError(false);
        })
        .catch(() => {
          if (!isActive) {
            return;
          }

          setTokenCount(0);
          setHasTokenizerError(true);
        });
    }, TOKEN_COUNT_DEBOUNCE_MS);

    return () => {
      isActive = false;
      window.clearTimeout(timeoutID);
    };
  }, [value]);

  const overSoftLimit = tokenCount > softLimit;
  const currentLimit = Math.max(softLimit, Math.ceil(tokenCount / softLimit) * softLimit);

  return (
    <div className={cn('mt-1 flex items-center justify-end px-1', className)}>
      <span
        className={cn(
          'text-[10px] font-mono uppercase tracking-wide text-muted-foreground/70',
          hasTokenizerError && 'text-destructive',
          overSoftLimit && 'text-amber-500'
        )}
      >
        {hasTokenizerError ? 'Tokens unavailable' : `${tokenCount}/${currentLimit}`}
      </span>
    </div>
  );
}
