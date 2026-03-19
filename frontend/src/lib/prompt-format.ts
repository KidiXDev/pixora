export type CommaSpacingMode = 'single' | 'none';

export interface PromptFormatOptions {
  collapseMultiline: boolean;
  collapseWhitespace: boolean;
  commaSpacingMode: CommaSpacingMode;
}

export const DEFAULT_PROMPT_FORMAT_OPTIONS: PromptFormatOptions = {
  collapseMultiline: true,
  collapseWhitespace: true,
  commaSpacingMode: 'single'
};

export function formatPromptText(
  input: string,
  options: PromptFormatOptions
): string {
  let result = input;

  if (options.collapseMultiline) {
    result = result.replace(/[\r\n]+/g, ' ');
  }

  if (options.collapseWhitespace) {
    result = result.replace(/[ \t]+/g, ' ');
  }

  if (options.commaSpacingMode === 'single') {
    result = result.replace(/\s*,\s*/g, ', ');
  } else {
    result = result.replace(/\s*,\s*/g, ',');
  }

  return result.trim();
}
