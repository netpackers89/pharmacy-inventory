import React, { useEffect, useState } from 'react';
import { socket } from '../services/socket';

/*
 * Tiny realtime status indicator (● Live / ↻ Updating).
 * Purely informational — sockets are an enhancement, never a dependency.
 */
export const LiveIndicator = () => {
  const [connected, setConnected] = useState(socket.connected);
  const [justUpdated, setJustUpdated] = useState(false);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onUpdate = () => {
      setJustUpdated(true);
      const t = setTimeout(() => setJustUpdated(false), 1600);
      return () => clearTimeout(t);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('data_updated', onUpdate);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('data_updated', onUpdate);
    };
  }, []);

  if (!connected) return null;
  return (
    <span className="live-indicator" title="Realtime updates active">
      <span className={`live-dot ${justUpdated ? 'pulse' : ''}`} />
      {justUpdated ? 'Updating…' : 'Live'}
    </span>
  );
};