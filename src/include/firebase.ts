import * as admin from 'firebase-admin';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import path from 'path';
import { getFirestore } from 'firebase-admin/firestore';
import os from 'os';

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}
const serviceAccountPath = path.resolve(__dirname, '../../homework-gai-firebase-adminsdk-jifl9-188caca7e1.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(require(serviceAccountPath)),
        projectId: 'homework-gai'
    });
}
if (!admin.apps.length) {
    initializeApp({ credential: applicationDefault() });
}
const db = getFirestore();

// Connect to emulators in development
if (process.env.NODE_ENV !== 'production') {
    // const emulatorHost = getLocalIp();
    const emulatorHost = process.env.FIREBASE_EMULATOR_HOST || 'host.docker.internal';


    db.settings({
        host: `${emulatorHost}:8808`,
        ssl: false,
    });

    // Auth emulator
    process.env.FIREBASE_AUTH_EMULATOR_HOST = `${emulatorHost}:9191`;

    // Storage emulator
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = `${emulatorHost}:9199`;
}

export { admin, db };
