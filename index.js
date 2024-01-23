import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Server } from 'socket.io'
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { availableParallelism } from 'node:os';
import cluster from 'node:cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';

// Abrir o arquivo de banco de dados
const db = await open({
  filename: 'chat.db',
  driver: sqlite3.Database
});

// criar nossa tabela de 'mensagens' (você pode ignorar a coluna 'client_offset' por enquanto)
await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TEXT
  );
`);

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  // criar um trabalhador por núcleo disponível
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: 3000 + i
    });
  }
  
  // Configurar o adaptador no thread primário
  setupPrimary();
}else{
const app = express();
const server = createServer(app);
// const io = new Server(server)
const io = new Server(server, {
  connectionStateRecovery: {},
  // Configurar o adaptador em cada thread de trabalho
  adapter: createAdapter()
});
// Cada trabalhador ouvirá em uma porta distinta


const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', async (socket) => {
  socket.on('chat message', async (msg, clientOffset, callback) => {
    let result;
    try {
      // Armazenar a mensagem no banco de dados
      result = await db.run('INSERT INTO messages (content, client_offset) VALUES (?, ?)', msg, clientOffset);
    } catch (e) {
      //  lidar com a falha
      if (e.errno === 19 /* SQLITE_CONSTRAINT */ ) {
        // A mensagem já foi inserida, por isso notificamos o cliente
        callback();
      } else {
        // nada a fazer, apenas deixe o cliente tentar novamente
      }
      return;
  
    }
    // Incluir o deslocamento com a mensagem
    io.emit('chat message', msg, result.lastID);
    // reconhecer o evento
    callback();
  });

  if (!socket.recovered) {
    // se a recuperação do estado da conexão não foi bem-sucedida
    try {
      await db.each('SELECT id, content FROM messages WHERE id > ?',
        [socket.handshake.auth.serverOffset || 0],
        (_err, row) => {
          socket.emit('chat message', row.content, row.id);
        }
      )
    } catch (e) {
      // algo deu errado
    }
  }
});

// server.listen(3000, () => {
//   console.log('server running at http://localhost:3000');
// });

const port = process.env.PORT;

server.listen(port, () => {
  console.log(`server running at http://localhost:${port}`);
});
}
// https://socket.io/docs/v4/tutorial/step-6