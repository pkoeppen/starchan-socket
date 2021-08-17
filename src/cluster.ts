import cluster from 'cluster';
import http from 'http';
import { setupPrimary } from '@socket.io/sticky';

const WORKERS_COUNT = 4;

if (cluster.isPrimary) {
  console.log(`Master ${process.pid} is running`);

  for (let i = 0; i < WORKERS_COUNT; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork();
  });

  const httpServer = http.createServer();
  setupPrimary(httpServer, {
    loadBalancingMethod: 'least-connection', // either "random", "round-robin" or "least-connection"
  });
  const PORT = process.env.PORT || 3002;

  httpServer.listen(PORT, () =>
    console.log(`server listening at http://localhost:${PORT}`)
  );
} else {
  console.log(`Worker ${process.pid} started`);
  require('./index');
}
