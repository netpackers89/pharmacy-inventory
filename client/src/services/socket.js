import { io } from 'socket.io-client';

let socketUrl = import.meta.env.VITE_API_URL || 'https://localhost:5000';
socketUrl = socketUrl.trim().replace(/^\[+|\]+$/g, '');
if (!/^https?:\/\//i.test(socketUrl)) socketUrl = `https://${socketUrl}`;

export const socket = io(socketUrl, {
  autoConnect: false
});
