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
  }
};
