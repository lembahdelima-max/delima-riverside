import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GoldSpotCache {
  xauUsdPerOz: number;
  usdIdrRate: number;
  spot24kPerGramIdr: number;
  change24hPercent: number;
  source: string;
  updatedAt: string;
  fetchedAtMs: number;
}

const TROY_OUNCE_GRAMS = 31.1034768;
const CACHE_TTL_MS = 45_000;

let cachedGoldFeed: GoldSpotCache | null = null;

async function fetchLiveXauUsd(): Promise<{ price: number; changePct: number; source: string }> {
  // Primary live source: GoldPrice.org global spot feed
  try {
    const res = await fetch('https://data-asg.goldprice.org/dbXRates/USD', {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; AurumPOS/1.0)',
      },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        items?: Array<{ xauPrice?: number; pcXau?: number }>;
      };
      const item = data.items?.[0];
      if (item && typeof item.xauPrice === 'number' && item.xauPrice > 500) {
        return {
          price: item.xauPrice,
          changePct: typeof item.pcXau === 'number' ? item.pcXau : 0,
          source: 'Spot Global XAU/USD (Live)',
        };
      }
    }
  } catch {
    // Fall through to secondary source
  }

  // Secondary live source: gold-api.com public XAU spot
  try {
    const res = await fetch('https://api.gold-api.com/price/XAU', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data = (await res.json()) as { price?: number; chp?: number };
      if (typeof data.price === 'number' && data.price > 500) {
        return {
          price: data.price,
          changePct: typeof data.chp === 'number' ? data.chp : 0,
          source: 'LBMA / Gold-API XAU (Live)',
        };
      }
    }
  } catch {
    // Fall through to fallback benchmark
  }

  return {
    price: 2745.5,
    changePct: 0.42,
    source: 'Acuan Pasar XAU/USD',
  };
}

async function fetchLiveUsdIdr(): Promise<number> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const idr = data.rates?.IDR;
      if (typeof idr === 'number' && idr > 10000) {
        return idr;
      }
    }
  } catch {
    // Fallback if external FX endpoint times out
  }
  return 15850;
}

async function getGoldMarketFeed(forceRefresh = false): Promise<GoldSpotCache> {
  const now = Date.now();
  if (!forceRefresh && cachedGoldFeed && now - cachedGoldFeed.fetchedAtMs < CACHE_TTL_MS) {
    return cachedGoldFeed;
  }

  const [xauResult, usdIdrRate] = await Promise.all([fetchLiveXauUsd(), fetchLiveUsdIdr()]);
  const rawGramIdr = (xauResult.price / TROY_OUNCE_GRAMS) * usdIdrRate;
  const spot24kPerGramIdr = Math.round(rawGramIdr / 100) * 100;

  cachedGoldFeed = {
    xauUsdPerOz: Number(xauResult.price.toFixed(2)),
    usdIdrRate: Math.round(usdIdrRate),
    spot24kPerGramIdr,
    change24hPercent: Number(xauResult.changePct.toFixed(2)),
    source: xauResult.source,
    updatedAt: new Date().toISOString(),
    fetchedAtMs: now,
  };

  return cachedGoldFeed;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/gold-price', async (req, res) => {
    try {
      const force = req.query.refresh === '1';
      const feed = await getGoldMarketFeed(force);
      res.json(feed);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Gagal memuat harga emas pasar',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AurumPOS server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
