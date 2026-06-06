import { connect } from 'cloudflare:sockets';

const UUID = '52273c55-beaf-40a2-b67b-f83cdc88277d';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('ALMEER Proxy Active ✅', { status: 200 });
    }

    if (url.pathname === '/config') {
      const host = request.headers.get('host');
      const config = `vless://${UUID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=%2Fvless#ALMEER-CF`;
      return new Response(config, { status: 200 });
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      return handleVLESS(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleVLESS(request) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();

  server.addEventListener('message', async ({ data }) => {
    const view = new DataView(data instanceof ArrayBuffer ? data : data.buffer);
    const version = view.getUint8(0);
    const uuidBytes = new Uint8Array(data, 1, 16);
    const clientUUID = bytesToUUID(uuidBytes);

    if (clientUUID !== UUID) {
      server.close(1008, 'Unauthorized');
      return;
    }

    const optLength = view.getUint8(17);
    const cmd = view.getUint8(18 + optLength);
    const port = view.getUint16(19 + optLength);
    const addrType = view.getUint8(21 + optLength);

    let address = '';
    let addrOffset = 22 + optLength;

    if (addrType === 1) {
      address = Array.from(new Uint8Array(data, addrOffset, 4)).join('.');
      addrOffset += 4;
    } else if (addrType === 2) {
      const len = view.getUint8(addrOffset++);
      address = new TextDecoder().decode(new Uint8Array(data, addrOffset, len));
      addrOffset += len;
    } else if (addrType === 3) {
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(view.getUint16(addrOffset + i * 2).toString(16));
      }
      address = ipv6.join(':');
      addrOffset += 16;
    }

    server.send(new Uint8Array([version, 0]));

    const payload = data.slice(addrOffset);
    const remote = connect({ hostname: address, port });
    const writer = remote.writable.getWriter();
    await writer.write(payload);
    writer.releaseLock();

    remote.readable.pipeTo(new WritableStream({
      write(chunk) { server.send(chunk); },
      close() { server.close(); }
    }));

    server.addEventListener('message', async ({ data }) => {
      const w = remote.writable.getWriter();
      await w.write(typeof data === 'string' ? new TextEncoder().encode(data) : data);
      w.releaseLock();
    });
  });

  return new Response(null, { status: 101, webSocket: client });
}

function bytesToUUID(bytes) {
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10).join('')}`;
        }
