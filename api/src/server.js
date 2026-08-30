import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/v1/health', (_req, res) => {
  res.json({
    success: true,
    service: 'a4print-hub-api',
    status: 'ok'
  });
});

app.use('/api/v1/orders', (_req, res) => {
  res.status(501).json({
    success: false,
    error: 'ORDERS_NOT_IMPLEMENTED',
    message: 'Orders API will be connected to Supabase in the next implementation step.'
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    error: 'INTERNAL_SERVER_ERROR'
  });
});

app.listen(port, () => {
  console.log(`A4PRINT HUB API listening on port ${port}`);
});
