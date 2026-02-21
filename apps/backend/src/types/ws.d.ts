import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';

declare module 'ws' {
  type RawData = Buffer | ArrayBuffer | Buffer[];

  class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readyState: number;
    send(data: any, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
  }

  class WebSocketServer extends EventEmitter {
    constructor(options?: { noServer?: boolean });
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WebSocket) => void): void;
    emit(event: 'connection', ws: WebSocket, request: IncomingMessage): boolean;
    on(event: 'connection', listener: (ws: WebSocket, request: IncomingMessage) => void): this;
  }

  export { WebSocket, WebSocketServer, RawData };
}
