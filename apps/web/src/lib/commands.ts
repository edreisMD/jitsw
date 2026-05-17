/**
 * GBrain + GStack commands exposed natively in the JITSW UI.
 *
 * Slack-style "remember the slash command" UX is bad; agent-native UIs should
 * surface the canonical commands as taps. These map to operations the
 * connected OpenClaw+GBrain+GStack agent can execute when the user picks one.
 *
 * Tap a command -> JITSW emits a `m.room.message` to the bot with body
 *   "/<command-id>" + custom content { com.jitsw.command: { id, args? } }
 * The bot (OpenClaw, instructed by the JITSW skill) executes the command and
 * replies with an A2UI surface JITSW renders.
 */

export type CommandKind = 'gbrain' | 'gstack' | 'agent';

export interface Command {
  id: string;
  label: string;
  hint: string;
  kind: CommandKind;
  /** Tools/operations this resolves to on the agent side. Used for tooltips/docs. */
  resolvesTo?: string;
}

export const COMMANDS: Command[] = [
  // ---- GBrain ----
  {
    id: 'ask',
    label: 'Ask the brain',
    hint: 'Search your GBrain with citations',
    kind: 'gbrain',
    resolvesTo: 'gbrain.query',
  },
  {
    id: 'recall',
    label: 'Recall recent',
    hint: 'Surface salient memories from the last few days',
    kind: 'gbrain',
    resolvesTo: 'gbrain.recall',
  },
  {
    id: 'save-note',
    label: 'Save a note',
    hint: 'Write a new page to your brain',
    kind: 'gbrain',
    resolvesTo: 'gbrain.put_page',
  },
  {
    id: 'people',
    label: 'Find people',
    hint: 'Look up someone you know',
    kind: 'gbrain',
    resolvesTo: 'gbrain.find_experts',
  },
  {
    id: 'extract-facts',
    label: 'Extract facts',
    hint: 'Pull facts from the current thread into memory',
    kind: 'gbrain',
    resolvesTo: 'gbrain.extract_facts',
  },

  // ---- GStack ----
  {
    id: 'ship',
    label: 'Ship',
    hint: 'Land changes with proof',
    kind: 'gstack',
    resolvesTo: 'gstack.ship',
  },
  {
    id: 'review',
    label: 'Review PR',
    hint: 'Open a PR review',
    kind: 'gstack',
    resolvesTo: 'gstack.review',
  },
  {
    id: 'investigate',
    label: 'Investigate',
    hint: 'Trace a bug, surface evidence',
    kind: 'gstack',
    resolvesTo: 'gstack.investigate',
  },
  {
    id: 'office-hours',
    label: 'Office hours',
    hint: 'Brainstorm with the operator persona',
    kind: 'gstack',
    resolvesTo: 'gstack.office-hours',
  },

  // ---- Agent / system ----
  {
    id: 'new-agent',
    label: 'Spin up agent',
    hint: 'Provision a new OpenClaw + GBrain agent',
    kind: 'agent',
    resolvesTo: 'gbrain.io/provision',
  },
  {
    id: 'agents',
    label: 'Your agents',
    hint: 'Show what is running and what they are working on',
    kind: 'agent',
    resolvesTo: 'openclaw.list',
  },
];

export const COMMANDS_BY_KIND: Record<CommandKind, Command[]> = COMMANDS.reduce(
  (acc, c) => {
    (acc[c.kind] ??= []).push(c);
    return acc;
  },
  {} as Record<CommandKind, Command[]>,
);
