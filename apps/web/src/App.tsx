/**
 * App shell. Routes between EmptyState (no packets) and Feed (TikTok-style).
 *
 * Commands tapped in the EmptyState are sent as user actions through the
 * transport. They surface to the agent as `com.jitsw.command` events; the
 * agent (OpenClaw, instructed by the JITSW skill) replies with an A2UI
 * surface that becomes the first card in the feed.
 */
import { useEffect, useState } from 'react';
import type { Packet, StreamEvent } from '@jitsw/shared';
import { EmptyState } from './routes/EmptyState';
import { Feed } from './routes/Feed';
import { HttpTransport } from './transport/http';
import type { Command } from './lib/commands';

const transport = new HttpTransport();

export function App() {
  const [packets, setPackets] = useState<Packet[]>([]);

  useEffect(() => {
    transport
      .listPackets()
      .then(setPackets)
      .catch((err) =>
        console.warn('[app] listPackets failed (API down?)', err),
      );

    const unsub = transport.subscribe((evt: StreamEvent) => {
      if (evt.type === 'packet') {
        setPackets((prev) => {
          if (prev.some((p) => p.id === evt.packet.id)) return prev;
          // Newest at the top — feed is reverse-chronological.
          return [evt.packet, ...prev];
        });
      }
    });
    return unsub;
  }, []);

  const handleSpinUpAgent = () => {
    // Placeholder: bounce to gbrain.io. Wire real OAuth + provisioning next.
    window.location.href = 'https://gbrain.io';
  };

  const handleCommand = (cmd: Command) => {
    // Send the command as a "user action" on a synthetic packet id 'console'.
    // The Matrix bridge interprets actions targeted at 'console' as agent
    // prompts. For HTTP-only mode this is also stored as a virtual action.
    transport
      .sendAction({
        packetId: 'console',
        name: cmd.id,
        surfaceId: 'console',
        sourceComponentId: cmd.id,
        context: { commandId: cmd.id, kind: cmd.kind },
      })
      .catch((err) => console.error('[app] command failed', err));
  };

  if (packets.length === 0) {
    return (
      <EmptyState
        onSpinUpAgent={handleSpinUpAgent}
        onCommand={handleCommand}
      />
    );
  }

  return <Feed packets={packets} transport={transport} />;
}
