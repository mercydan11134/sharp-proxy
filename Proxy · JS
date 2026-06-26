const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// API Keys
const FD_KEY = 'd6cc20230f8d4ee087dcaf0a3a8b5ee5';   // football-data.org
const FD_HOST = 'https://api.football-data.org/v4';
const ODDS_KEY = '1c13328b';                            // OddsPapi
const ODDS_HOST = 'https://api.oddspapi.io';

app.use(cors());
app.use(express.json());

// ── RATE LIMITER (football-data.org: 10 req/min) ──
let lastFDRequest = 0;
const FD_GAP = 700;

async function fdGet(url, params = {}) {
  const now = Date.now();
  const wait = Math.max(0, lastFDRequest + FD_GAP - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFDRequest = Date.now();
  return axios.get(url, {
    headers: { 'X-Auth-Token': FD_KEY },
    params,
    timeout: 15000
  });
}

// ══════════════════════════════════════
// FOOTBALL-DATA.ORG ENDPOINTS
// ══════════════════════════════════════

// Teams in competition
app.get('/api/teams', async (req, res) => {
  try {
    const { competition } = req.query;
    if (!competition) return res.status(400).json({ error: 'competition required', teams: [] });
    const r = await fdGet(`${FD_HOST}/competitions/${competition}/teams`);
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message, teams: [] });
  }
});

// Team recent matches
app.get('/api/team-matches/:teamId', async (req, res) => {
  try {
    const r = await fdGet(`${FD_HOST}/teams/${req.params.teamId}/matches`, {
      status: req.query.status || 'FINISHED',
      limit: req.query.limit || 15
    });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message, matches: [] });
  }
});

// Competition matches by date
app.get('/api/competition-matches/:competition', async (req, res) => {
  try {
    const r = await fdGet(`${FD_HOST}/competitions/${req.params.competition}/matches`, {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message, matches: [] });
  }
});

// Standings
app.get('/api/standings/:competition', async (req, res) => {
  try {
    const r = await fdGet(`${FD_HOST}/competitions/${req.params.competition}/standings`);
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message, standings: [] });
  }
});

// H2H
app.get('/api/h2h/:teamId', async (req, res) => {
  try {
    const r = await fdGet(`${FD_HOST}/teams/${req.params.teamId}/matches`, {
      status: 'FINISHED',
      limit: 50
    });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message, matches: [] });
  }
});

// ══════════════════════════════════════
// ODDSPAPI ENDPOINTS (odds + line movement)
// ══════════════════════════════════════

// Get fixtures with odds for a competition
app.get('/api/odds/fixtures', async (req, res) => {
  try {
    const { sportId, date, leagueName } = req.query;
    const r = await axios.get(`${ODDS_HOST}/fixtures`, {
      params: {
        apiKey: ODDS_KEY,
        sportId: sportId || 10, // 10 = football/soccer
        date: date,
        leagueName: leagueName || undefined
      },
      timeout: 15000
    });
    res.json(r.data);
  } catch (e) {
    console.error('OddsPapi fixtures error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, data: [] });
  }
});

// Get odds for a specific fixture (includes opening + current + Pinnacle)
app.get('/api/odds/match', async (req, res) => {
  try {
    const { fixtureId, marketId } = req.query;
    // marketId 1 = 1X2 (home/draw/away)
    const r = await axios.get(`${ODDS_HOST}/odds`, {
      params: {
        apiKey: ODDS_KEY,
        fixtureId: fixtureId,
        marketId: marketId || 1,
        bookmakers: 'Pinnacle,Bet365,William Hill'
      },
      timeout: 15000
    });
    res.json(r.data);
  } catch (e) {
    console.error('OddsPapi odds error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, data: [] });
  }
});

// Search fixtures by team names (to find fixture ID)
app.get('/api/odds/search', async (req, res) => {
  try {
    const { homeTeam, awayTeam, date } = req.query;
    const r = await axios.get(`${ODDS_HOST}/fixtures`, {
      params: {
        apiKey: ODDS_KEY,
        sportId: 10,
        date: date
      },
      timeout: 15000
    });

    const fixtures = r.data?.data || r.data || [];
    const hn = homeTeam.toLowerCase();
    const an = awayTeam.toLowerCase();

    const match = fixtures.find(f => {
      const h = (f.home || f.homeTeam || f.home_team || '').toLowerCase();
      const a = (f.away || f.awayTeam || f.away_team || '').toLowerCase();
      return (h.includes(hn) || hn.includes(h)) && (a.includes(an) || an.includes(a));
    });

    res.json({ fixture: match || null, allFixtures: fixtures.slice(0, 5) });
  } catch (e) {
    console.error('OddsPapi search error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, fixture: null });
  }
});

// ══════════════════════════════════════
// WEATHER (Open-Meteo — free, no key)
// ══════════════════════════════════════
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon, date } = req.query;
    const r = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat,
        longitude: lon,
        hourly: 'temperature_2m,precipitation,windspeed_10m',
        timezone: 'auto',
        start_date: date,
        end_date: date
      },
      timeout: 10000
    });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HEALTH CHECK ──
app.get('/health', (req, res) => {
  res.json({
    status: 'SHARP ENGINE ONLINE',
    sources: ['football-data.org', 'oddspapi.io', 'open-meteo.com'],
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'SHARP proxy running', version: '7.0' });
});

app.listen(PORT, () => {
  console.log(`SHARP Proxy v7.0 running on port ${PORT}`);
});
