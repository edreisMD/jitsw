/**
 * SurfaceHost — renders an A2UI v0.8 envelope using @a2ui/lit.
 *
 * @a2ui/lit's API (as of 0.10.0):
 *   - Create a processor via `Data.createSignalA2uiMessageProcessor()`.
 *   - Feed the protocol messages: `processor.processMessages([...])`.
 *   - Register the custom elements via `import('@a2ui/lit/ui')`.
 *   - Mount `<a2ui-surface>`, set `.processor` and `.surfaceId` properties.
 *   - Listen for `a2uiaction` to capture user interactions.
 *
 * The envelope's `surfaceId` defaults to "main" (matches what the JITSW skill
 * tells OpenClaw to use). For multi-surface packets we pick the first key.
 */
import { useEffect, useRef } from 'react';
import type { A2UIEnvelope } from '@jitsw/shared';

export interface SurfaceHostProps {
  envelope: A2UIEnvelope;
  /** Called when the user interacts with the surface. */
  onAction?: (action: {
    name: string;
    surfaceId: string;
    sourceComponentId: string;
    context?: Record<string, unknown>;
  }) => void;
}

export function SurfaceHost({ envelope, onAction }: SurfaceHostProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    let disposed = false;
    const host = ref.current;
    if (!host) return;

    (async () => {
      // Importing /ui registers <a2ui-surface> and the rest of the elements.
      // Core export gives us the Data processor factory.
      const [{ Data }] = await Promise.all([
        import('@a2ui/lit/v0_8'),
        import('@a2ui/lit/ui'),
      ]);
      if (disposed) return;

      const processor = Data.createSignalA2uiMessageProcessor();
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        processor.processMessages(envelope.messages as any);
      } catch (err) {
        console.warn('[a2ui] processMessages threw', err);
      }

      const surfaceId = pickSurfaceId(processor);
      const surface = document.createElement('a2ui-surface') as HTMLElement & {
        processor: unknown;
        surfaceId: string | null;
      };
      surface.processor = processor;
      surface.surfaceId = surfaceId;
      host.replaceChildren(surface);

      surface.addEventListener('a2uiaction', (evt: Event) => {
        const ce = evt as CustomEvent<{
          name?: string;
          surfaceId?: string;
          sourceComponentId?: string;
          context?: Record<string, unknown>;
        }>;
        onActionRef.current?.({
          name: ce.detail?.name ?? '',
          surfaceId: ce.detail?.surfaceId ?? surfaceId,
          sourceComponentId: ce.detail?.sourceComponentId ?? '',
          context: ce.detail?.context,
        });
      });
    })().catch((err) => {
      console.error('[a2ui] failed to mount surface', err);
      if (host) host.textContent = 'Failed to render A2UI surface.';
    });

    return () => {
      disposed = true;
      if (host) host.replaceChildren();
    };
  }, [envelope]);

  return <div ref={ref} />;
}

/** Pick a surface id from the processor. Defaults to "main" or first known. */
function pickSurfaceId(processor: {
  getSurfaces: () => ReadonlyMap<string, unknown>;
}): string {
  const surfaces = processor.getSurfaces();
  if (surfaces.has('main')) return 'main';
  const first = surfaces.keys().next();
  return first.done ? 'main' : first.value;
}
