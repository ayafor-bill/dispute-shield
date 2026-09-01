require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

// Stripe webhooks need the raw body for signature verification,
// so that route is mounted BEFORE the global json parser.
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), require('./routes/webhooks.stripe'));

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', require('./routes/auth'));
app.use('/disputes', require('./routes/disputes'));
app.use('/orders', require('./routes/orders'));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const path = require('path');
app.use('/.well-known', express.static(path.join(__dirname, 'well-known')));

module.exports = app;
