let io;

module.exports = {
  init: (httpServer, corsOptions) => {
    const { Server } = require('socket.io');
    io = new Server(httpServer, {
      cors: corsOptions
    });
    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io not initialized!');
    }
    return io;
  },
  /*
   * Broadcast a data-change event to every connected client so dashboards,
   * POS stock lists and reports refresh with REAL data instead of stale
   * caches. Never throws - sockets are an enhancement, not a dependency.
   */
  emitDataUpdated: (topic = 'general') => {
    try {
      if (io) io.emit('data_updated', { topic, at: new Date().toISOString() });
    } catch (_) { /* ignore */ }
  }
};
