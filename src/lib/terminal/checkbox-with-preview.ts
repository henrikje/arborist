import {
  type CheckboxWithStatusChoice,
  type CheckboxWithStatusConfig,
  checkboxWithStatus,
} from "./checkbox-with-status";

export type CheckboxWithPreviewChoice<T> = CheckboxWithStatusChoice<T>;

export interface CheckboxWithPreviewConfig<T> extends CheckboxWithStatusConfig<T> {
  preview: (selected: T[], maxLines: number) => string;
}

export const checkboxWithPreview: <T>(
  config: CheckboxWithPreviewConfig<T>,
  context?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; clearPromptOnDone?: boolean },
) => Promise<T[]> = checkboxWithStatus;
