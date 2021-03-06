import { Client } from "./client.ts";
import { writeVarInt } from "./util/varint.ts";
import { deserialize } from "./serde/deserializer.ts";
import { type ServerBoundPayloads, State } from "./types/mod.ts";

interface PlayerInfo {
  uuid: string;
  name: string;
}

interface QueueEntry {
  clientIndex: number;
  payload: ServerBoundPayloads;
}

interface ServerInfo {
  version: {
    name: "1.18.2";
    protocol: 758;
  };
  players: {
    max: number;
    online: number;
    sample?: PlayerInfo[];
  };
  description?: unknown;
  favicon?: `data:image/png;base64,${string}`;
}

interface ServerConfig {
  port: number;
  maxPlayers: number;
  motd: string;
  favicon?: string;
}

export class Server {
  #inner: Deno.Listener;
  #queue: QueueEntry[] = [];
  #queueLock: Promise<void>;
  #releaseQueueLock!: CallableFunction;
  #rejectQueueLock!: CallableFunction;
  clients: Client[];
  serverInfo: ServerInfo;

  async #process(data: QueueEntry): Promise<void> {
    const _client = this.clients[data.clientIndex];
    await data.payload;
  }

  async #tick() {
    await this.#getLock();
    const queue = this.#queue;
    this.#queue = [];
    this.#releaseQueueLock();
    queue.map((x) => this.#process(x));
  }

  async #getLock() {
    await this.#queueLock;

    this.#queueLock = new Promise((
      res,
      rej,
    ) => (this.#releaseQueueLock = res, this.#rejectQueueLock = rej));
  }

  constructor(config: ServerConfig) {
    this.clients = new Array(config.maxPlayers);
    this.#inner = Deno.listen({ port: config.port, transport: "tcp" });

    this.serverInfo = {
      version: {
        name: "1.18.2",
        protocol: 758,
      },
      players: {
        online: 0,
        max: config.maxPlayers,
      },
      description: {
        text: config.motd,
      },
    };

    this.#queueLock = Promise.resolve();

    if (config.favicon) {
      const encodedString = btoa(
        String.fromCharCode(...Deno.readFileSync(config.favicon)),
      );
      this.serverInfo.favicon = `data:image/png;base64,${encodedString}`;
    }
  }

  async listen() {
    for await (const conn of this.#inner) this.connectClient(conn);
  }

  async connectClient(conn: Deno.Conn): Promise<void> {
    const client = new Client(conn);
    const payloadBinary = await client.poll();
    if (payloadBinary[0] === 0xFE) return client.drop();

    // Only wants status
    if (payloadBinary[payloadBinary.length - 1] === 1) {
      // TODO: Send list ping
      client.state = State.Status;
      await client.poll();

      const jsonBuffer = new TextEncoder().encode(
        JSON.stringify(this.serverInfo, undefined, 0),
      );

      const varIntBytes = writeVarInt(jsonBuffer.length);
      const responsePayload = new Uint8Array([
        0x00,
        ...varIntBytes,
        ...jsonBuffer,
      ]);
      const packet = new Uint8Array([
        ...writeVarInt(responsePayload.length),
        ...responsePayload,
      ]);

      await client.send(packet);
      const pbuff = await client.poll();

      await client.send(
        new Uint8Array([...writeVarInt(pbuff.length), ...pbuff]),
      );

      return client.drop();
    }

    // TODO: Check if user is banned

    let clientIndex;
    try {
      clientIndex = this.addClient(client);
    } catch (_) {
      // TODO: Respond with Login Disconnect
      return client.drop();
    }

    this.serverInfo.players.online++;

    for await (const serializedPayload of client.startPolling()) {
      try {
        const payload = deserialize(serializedPayload, client.state);

        await this.#getLock();
        this.#queue.push({ clientIndex, payload: payload });
        this.#releaseQueueLock();
      } catch (_) {
        // TODO: Disconnect User
      }
    }

    // Client disconnected for whatever reason (listener is dropped somewhere else already)
    delete this.clients[clientIndex];
    this.serverInfo.players.online--;
  }

  addClient(client: Client): number {
    const index = this.clients.findIndex((x) => !x);
    if (!index) throw new Error("No Free space");

    this.clients[index] = client;
    return index;
  }
}
