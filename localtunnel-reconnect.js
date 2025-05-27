const localtunnel = require('localtunnel');

const port = 3000;
const subdomain = 'wamatura';
const reconnectDelay = 1000; // milliseconds
let count = 0;

const config = {
  subdomain: subdomain
};
async function startTunnel() {
  try {
    console.log(config, `\n\nAttempting to establish tunnel on port ${port} with subdomain ${config.subdomain}...`);
    const tunnel = await localtunnel({
      port: 3000,
      subdomain: subdomain,

    });
    count++;

    console.log(`Tunnel (${count}) established at ${tunnel.url}`);

    tunnel.on('close', () => {
      console.warn('Tunnel closed. Attempting to reconnect...');
      setTimeout(startTunnel, reconnectDelay);
    });

    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err);
      setTimeout(startTunnel, reconnectDelay);
    });
  } catch (err) {
    console.error('Failed to establish tunnel:', err);
    setTimeout(startTunnel, reconnectDelay);
  }
}

startTunnel();
