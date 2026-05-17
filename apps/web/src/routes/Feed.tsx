/**
 * Feed — TikTok-style vertical snap-scroll of A2UI surfaces.
 *
 * Each packet renders as a full-viewport card. The user swipes between cards.
 * The A2UI surface itself scrolls internally if the agent shipped a tall UI.
 *
 * Actions on a surface are sent back through the transport, which (for HTTP)
 * POSTs to /actions and (for Matrix) becomes a `com.jitsw.a2ui.action` event
 * in the originating room.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Packet } from '@jitsw/shared';
import { SurfaceHost } from '../a2ui/SurfaceHost';
import type { Transport } from '../transport';
import './feed.css';

export interface FeedProps {
  packets: Packet[];
  transport: Transport;
}

export function Feed({ packets, transport }: FeedProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLElement | null>(null);

  // Use IntersectionObserver to detect which card is currently snapped.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            const idx = Number(
              (entry.target as HTMLElement).dataset.index ?? '0',
            );
            setActiveIdx(idx);
          }
        }
      },
      { root: container, threshold: [0.6] },
    );

    for (const card of container.querySelectorAll('[data-card]')) {
      observer.observe(card);
    }

    return () => observer.disconnect();
  }, [packets.length]);

  const sendAction = useCallback(
    (packetId: string) =>
      (action: {
        name: string;
        surfaceId: string;
        sourceComponentId: string;
        context?: Record<string, unknown>;
      }) => {
        transport
          .sendAction({ packetId, ...action })
          .catch((err) => console.error('[feed] sendAction failed', err));
      },
    [transport],
  );

  return (
    <main className="feed" ref={containerRef}>
      {packets.map((p, i) => (
        <article
          key={p.id}
          className="feed__card"
          data-card
          data-index={i}
          data-kind={p.kind}
        >
          <header className="feed__head">
            <span className="feed__agent">{p.agent.name}</span>
            <span className="feed__kind">{p.kind.replace('_', ' ')}</span>
          </header>
          <h2 className="feed__title">{p.title}</h2>
          {p.summary && <p className="feed__summary">{p.summary}</p>}
          <div className="feed__surface">
            <SurfaceHost envelope={p.surface} onAction={sendAction(p.id)} />
          </div>
        </article>
      ))}

      {packets.length > 1 && (
        <div className="feed__pager" aria-hidden>
          {packets.map((p, i) => (
            <span
              key={p.id}
              className="feed__pager-dot"
              data-active={i === activeIdx}
            />
          ))}
        </div>
      )}
    </main>
  );
}
