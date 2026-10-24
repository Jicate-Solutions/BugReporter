'use client';

/**
 * The recipe form shared by "New AI task" and "Edit recipe": what the task
 * does, its instructions, the inputs an app must send, the model, the answer
 * type and its limits. Plain-English labels; the server re-validates all of it.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { TASK_MODELS } from '@/lib/ai-engine/task-key';

/** The recipe exactly as the API takes it. */
export interface RecipeValue {
  title: string;
  description: string;
  instructions: string;
  model: string;
  effort: string | null;
  output_format: 'text' | 'json';
  interactive: boolean;
  max_inflight: number;
  max_payload_bytes: number;
  timeout_seconds: number;
  max_answer_words: number | null;
  required_inputs: string[];
  queue_wait_seconds: number;
}

export const EMPTY_RECIPE: RecipeValue = {
  title: '',
  description: '',
  instructions: '',
  model: 'sonnet',
  effort: null,
  output_format: 'text',
  interactive: true,
  max_inflight: 2,
  max_payload_bytes: 32768,
  timeout_seconds: 120,
  max_answer_words: null,
  required_inputs: [],
  queue_wait_seconds: 120
};

const MODEL_HELP: Record<string, string> = {
  sonnet: 'sonnet — good default',
  opus: 'opus — strongest, slowest',
  haiku: 'haiku — fastest',
  fable: 'fable'
};

const INPUT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

function clamp(v: string, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n) || v === '') return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function RecipeFields({
  value,
  onChange,
  idPrefix,
  showTitle = true
}: {
  value: RecipeValue;
  onChange: (v: RecipeValue) => void;
  idPrefix: string;
  /** The create dialog uses the task name as the title, so it hides this field. */
  showTitle?: boolean;
}) {
  const [inputDraft, setInputDraft] = useState('');
  const set = (patch: Partial<RecipeValue>) => onChange({ ...value, ...patch });
  const models = TASK_MODELS.includes(value.model as (typeof TASK_MODELS)[number])
    ? [...TASK_MODELS]
    : [value.model, ...TASK_MODELS];

  function addInput() {
    const name = inputDraft.trim();
    if (!INPUT_RE.test(name) || value.required_inputs.includes(name)) return;
    set({ required_inputs: [...value.required_inputs, name] });
    setInputDraft('');
  }

  return (
    <div className="space-y-4">
      {showTitle && (
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-title`}>Name shown on this page</Label>
          <Input
            id={`${idPrefix}-title`}
            value={value.title}
            maxLength={120}
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-description`}>What it does</Label>
        <Input
          id={`${idPrefix}-description`}
          value={value.description}
          maxLength={500}
          placeholder="For example: turns a feedback form into three short points"
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-instructions`}>Instructions for the AI</Label>
        <p className="text-muted-foreground text-xs">
          Write what the AI should do, as you would brief a colleague. Whatever the app sends
          arrives separately, marked as DATA: the AI is told to treat it as information to work
          on, never as instructions. So refer to it (&ldquo;the feedback in the data&rdquo;)
          instead of pasting placeholders.
        </p>
        <Textarea
          id={`${idPrefix}-instructions`}
          value={value.instructions}
          rows={8}
          className="max-h-80 font-mono text-xs"
          onChange={(e) => set({ instructions: e.target.value })}
        />
        {value.instructions.trim().length > 0 && value.instructions.trim().length < 20 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Write at least 20 characters.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-input`}>Information the app must send</Label>
        <p className="text-muted-foreground text-xs">
          A request missing any of these is refused. Letters, numbers and _ only, for example
          feedback or student_name. Press Enter to add.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {value.required_inputs.map((name) => (
            <Badge key={name} variant="secondary" className="gap-1 font-mono">
              {name}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                className="hover:text-foreground"
                onClick={() =>
                  set({ required_inputs: value.required_inputs.filter((n) => n !== name) })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Input
            id={`${idPrefix}-input`}
            className="h-8 w-44"
            value={inputDraft}
            placeholder="add one"
            onChange={(e) => setInputDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addInput();
              }
            }}
            onBlur={addInput}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>AI model</Label>
          <Select value={value.model} onValueChange={(v) => set({ model: v })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {MODEL_HELP[m] ?? m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Answer type</Label>
          <Select
            value={value.output_format}
            onValueChange={(v) => set({ output_format: v as 'text' | 'json' })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Plain text — for people to read</SelectItem>
              <SelectItem value="json">JSON — for the app&apos;s code to read</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-words`}>Longest answer (words)</Label>
          <Input
            id={`${idPrefix}-words`}
            type="number"
            min={10}
            max={5000}
            placeholder="no limit"
            value={value.max_answer_words ?? ''}
            onChange={(e) =>
              set({
                max_answer_words:
                  e.target.value === '' ? null : clamp(e.target.value, 10, 5000, 10)
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-timeout`}>Time limit for one answer (seconds)</Label>
          <Input
            id={`${idPrefix}-timeout`}
            type="number"
            min={10}
            max={600}
            value={value.timeout_seconds}
            onChange={(e) => set({ timeout_seconds: clamp(e.target.value, 10, 600, 120) })}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-wait`}>Wait for a free box (seconds)</Label>
          <p className="text-muted-foreground text-xs">
            How long a request may wait for a JICATE computer to become free before it gives up.
          </p>
          <Input
            id={`${idPrefix}-wait`}
            type="number"
            min={5}
            max={3600}
            className="sm:w-44"
            value={value.queue_wait_seconds}
            onChange={(e) => set({ queue_wait_seconds: clamp(e.target.value, 5, 3600, 120) })}
          />
        </div>
      </div>
    </div>
  );
}

/** Shared POST helper: returns the parsed body, or shows the server's message. */
export async function postJson<T>(
  url: string,
  body: unknown,
  onError: (message: string) => void
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    const data = (await res.json().catch(() => null)) as
      | (T & { error?: { message?: string } })
      | null;
    if (!res.ok) {
      onError(data?.error?.message ?? 'Could not save. Try again.');
      return null;
    }
    return data as T;
  } catch {
    onError('Could not reach the server. Try again.');
    return null;
  }
}
