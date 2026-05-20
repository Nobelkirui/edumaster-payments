const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { initDB } = require('./db');
const licenseRoutes = require('./routes/license');
const webhookRoutes = require('./routes/webhook');

dotenv.config();

async function start() {
  await initDB();
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/license', licenseRoutes);
  app.use('/api/webhook', webhookRoutes);

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`License server running on port ${PORT}`));
}

start();
