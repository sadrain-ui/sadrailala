import { WebSocket, Server as WSServer } from 'ws';
import { getLogs } from './db';

interface Client {
  ws: WebSocket;
  cloneId: string;
  lastLogId: number;
}

class WebSocketHandler {
  private clients: Map<string, Client[]> = new Map();
  private wss: WSServer | null = null;

  initialize(server: any) {
    this.wss = new WSServer({ noServer: true });

    server.on('upgrade', (request: any, socket: any, head: any) => {
      if (request.url?.startsWith('/api/logs-stream')) {
        this.wss!.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          this.handleConnection(ws, request);
        });
      }
    });
  }

  private handleConnection(ws: WebSocket, request: any) {
    const url = new URL(request.url, 'ws://localhost');
    const cloneId = url.searchParams.get('cloneId');

    if (!cloneId) {
      ws.close(1008, 'Missing cloneId');
      return;
    }

    const client: Client = {
      ws,
      cloneId,
      lastLogId: 0,
    };

    // Add to clients list
    if (!this.clients.has(cloneId)) {
      this.clients.set(cloneId, []);
    }
    this.clients.get(cloneId)!.push(client);

    // Send initial logs
    const logs = getLogs(cloneId, 50);
    ws.send(
      JSON.stringify({
        type: 'initial',
        logs: logs.map((log: any) => ({
          timestamp: log.timestamp,
          type: log.type,
          message: log.message,
        })),
      })
    );

    // Handle messages
    ws.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        // Ignore invalid messages
      }
    });

    // Handle close
    ws.on('close', () => {
      const clients = this.clients.get(cloneId);
      if (clients) {
        const idx = clients.indexOf(client);
        if (idx !== -1) clients.splice(idx, 1);
      }
    });
  }

  // Broadcast new log to all subscribed clients
  broadcastLog(cloneId: string, log: any) {
    const clients = this.clients.get(cloneId);
    if (!clients) return;

    const message = JSON.stringify({
      type: 'log',
      log: {
        timestamp: log.timestamp,
        type: log.type,
        message: log.message,
      },
    });

    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

export const wsHandler = new WebSocketHandler();
