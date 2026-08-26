import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { NotificationJobs } from './modules/jobs/notificationJobs.js';
import { VoiceProviderManager } from './modules/voice/voiceProviderManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
const frontendPath = path.resolve(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// Mount API v1
app.use('/api/v1', apiRouter);

// Health check endpoint (generic)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'AI Receptionist SaaS' });
});

// OpenAPI Spec endpoint
app.get('/api-docs/openapi.json', (req, res) => {
  const openapiPath = path.resolve(__dirname, '../src/docs/openapi.json');
  res.sendFile(openapiPath);
});

// Centralized error handler
app.use(errorHandler);

// Background job timer for notifications (every 30 seconds)
setInterval(() => {
  NotificationJobs.processPendingNotifications().catch((err) => {
    console.error('Notification background job error', err);
  });
}, 30000);

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, () => {
    console.log(`[Walter Backend] Server running on http://localhost:${PORT}`);
    // Start voice providers after the HTTP server is listening
    VoiceProviderManager.getInstance()
      .startVoiceProviders()
      .catch((err) => {
        console.error('[VoiceProviderManager] Failed to start voice providers', err);
      });
  });

  // Graceful shutdown handling
  const shutdown = async () => {
    console.log('[Shutdown] Received signal, stopping voice providers...');
    try {
      await VoiceProviderManager.getInstance().stopVoiceProviders();
    } catch (e) {
      console.error('[Shutdown] Error stopping voice providers', e);
    }
    server.close(() => {
      console.log('[Shutdown] HTTP server closed');
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;

