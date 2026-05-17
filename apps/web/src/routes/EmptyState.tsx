/**
 * EmptyState — shown when there are no packets in the feed.
 *
 * Design intent (per Eduardo):
 *   - Background: #FDFDFC (warm paper)
 *   - "build something" in a slightly darker color (#B8B6AE, muted)
 *   - Below it: a single button to spin up a GBrain agent via gbrain.io
 *   - Native gbrain/gstack command chips so users never memorize slash commands
 *
 * Tapping a command sends a Matrix message to the connected agent (via the
 * JITSW API). The agent replies with an A2UI surface that lands in the feed.
 */
import { COMMANDS_BY_KIND, type Command } from '../lib/commands';
import './empty-state.css';

export interface EmptyStateProps {
  onSpinUpAgent: () => void;
  onCommand: (cmd: Command) => void;
}

export function EmptyState({ onSpinUpAgent, onCommand }: EmptyStateProps) {
  return (
    <main className="empty-state">
      <h1 className="empty-state__prompt">build something</h1>

      <button
        type="button"
        className="empty-state__cta"
        onClick={onSpinUpAgent}
      >
        Spin up a GBrain agent
      </button>

      <p className="empty-state__hint">
        Sign in with{' '}
        <a href="https://gbrain.io" target="_blank" rel="noreferrer">
          gbrain.io
        </a>{' '}
        to connect your brain.
      </p>

      <section className="empty-state__commands">
        <CommandGroup
          label="brain"
          commands={COMMANDS_BY_KIND.gbrain ?? []}
          onCommand={onCommand}
        />
        <CommandGroup
          label="stack"
          commands={COMMANDS_BY_KIND.gstack ?? []}
          onCommand={onCommand}
        />
      </section>
    </main>
  );
}

function CommandGroup({
  label,
  commands,
  onCommand,
}: {
  label: string;
  commands: Command[];
  onCommand: (cmd: Command) => void;
}) {
  if (commands.length === 0) return null;
  return (
    <div className="empty-state__group">
      <span className="empty-state__group-label">{label}</span>
      <div className="empty-state__chips">
        {commands.map((c) => (
          <button
            key={c.id}
            type="button"
            className="empty-state__chip"
            title={c.hint}
            onClick={() => onCommand(c)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
