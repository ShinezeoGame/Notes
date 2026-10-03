// Relais réseau du widget « Allumer un PC » (Wake-on-LAN). Le serveur Melo tourne dans Docker sur un réseau à part,
// d'où le signal de réveil n'atteint pas le réseau de la maison ; ce relais tourne sur le réseau de la machine hôte
// (docker-compose.yml, service « wol ») et envoie le signal, vérifie les ordinateurs et cherche les appareils à sa
// place. Il n'écoute que sur un socket Unix partagé avec le serveur (WOL_RELAY) : rien n'est ouvert sur le réseau, et
// il n'a pas accès aux données de Melo.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { isAction, runAction } from './wol.js';

const SOCKET = process.env.WOL_RELAY || '/run/melo-wol/relay.sock';

fs.mkdirSync(path.dirname(SOCKET), { recursive: true });
// Socket laissé par un arrêt brutal : remplacé.
fs.rmSync(SOCKET, { force: true });

const server = http.createServer((req, res) => {
  const reply = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const action = (req.url || '').slice(1);
  if (req.method !== 'POST' || !isAction(action)) {
    req.resume();
    return reply(404, { error: 'Introuvable.' });
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 10_000) req.destroy();
  });
  req.on('end', async () => {
    try {
      reply(200, await runAction(action, JSON.parse(body || '{}')));
    } catch (err) {
      reply(err.status || 500, { error: err.status ? err.message : 'Erreur du relais réseau.' });
      if (!err.status) console.error('[wol]', err);
    }
  });
});

server.listen(SOCKET, () => {
  fs.chmodSync(SOCKET, 0o660);
  console.log(`Melo : relais réseau du réveil des ordinateurs prêt (${SOCKET}).`);
});

function stop() {
  fs.rmSync(SOCKET, { force: true });
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
