const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// football-data.org API key
const FD_KEY = 'd6cc20230f8d4ee087dcaf0a3a8b5ee5';
const FD_HOST = 'https://api.football-data.org/v4';

app.use(cors());
app.use(express.json());

// ── RATE LIMIT PROTECTION ──
// football-data.org free tier allows 10 requests per minute.
// This ensures we never send requests faster than 1 every 700ms,
// keeping us safely under that limit so the account never gets suspended.
let lastRequestTime = 0;
const MIN_GAP_MS = 700;

async function throttledGet(url, config) {
  const now = Date.now();
  const wait = Math.max(0, lastRequestTime + MIN_GAP_MS - now);
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  lastRequestTime = Date.now();
  return axios.get(url, config);
}

// ── TEAMS (search within a competition) ──
app.get('/api/teams', async (req, res) => {
  try {
    const { competition } = req.query;
    if (!competition) return res.status(400).json({ error: 'competition required', teams: [] });

    const url = `${FD_HOST}/competitions/${competition}/teams`;
    const response = await throttledGet(url, {
      headers: { 'X-Auth-Token': FD_KEY },
      timeout: 15000
    });
    res.json(response.data);
  } catch (error) {
    console.error('Teams error:', error.message);
    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.message,
      details: error.response?.data || null,
      teams: []
    });
  }
});

// ── TEAM MATCHES (form, goals data, fixture history) ──
app.get('/api/team-matches/:teamId', async (req, res) => {
  try {
    const { teamId } = req.params;
    const { status, limit } = req.query;
    const url = `${FD_HOST}/teams/${teamId}/matches`;
    const response = await throttledGet(url, {
      headers: { 'X-Auth-Token': FD_KEY },
      params: { status: status || 'FINISHED', limit: limit || 15 },
      timeout: 15000
    });
    res.json(response.data);
  } catch (error) {
    console.error('Team matches error:', error.message);
    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.message,
      details: error.response?.data || null,
      matches: []
    });
  }
});

// ── COMPETITION MATCHES (find specific fixture by date) ──
app.get('/api/competition-matches/:competition', async (req, res) => {
  try {
    const { competition } = req.params;
    const { dateFrom, dateTo } = req.query;
    const url = `${FD_HOST}/competitions/${competition}/matches`;
    const response = await throttledGet(url, {
      headers: { 'X-Auth-Token': FD_KEY },
      params: { dateFrom, dateTo },
      timeout: 15000
    });
    res.json(response.data);
  } catch (error) {
    console.error('Competition matches error:', error.message);
    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.message,
      details: error.response?.data || null,
      matches: []
    });
  }
});

// ── STANDINGS ──
app.get('/api/standings/:competition', async (req, res) => {
  try {
    const { competition } = req.params;
    const url = `${FD_HOST}/competitions/${competition}/standings`;
    const response = await throttledGet(url, {
      headers: { 'X-Auth-Token': FD_KEY },
      timeout: 15000
    });
    res.json(response.data);
  } catch (error) {
    console.error('Standings error:', error.message);
    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.message,
      details: error.response?.data || null,
      standings: []
    });
  }
});

// ── HEAD TO HEAD (pulls team's match history, filtered client-side) ──
app.get('/api/h2h/:team1Id', async (req, res) => {
  try {
    const { team1Id } = req.params;
    const url = `${FD_HOST}/teams/${team1Id}/matches`;
    const response = await throttledGet(url, {
      headers: { 'X-Auth-Token': FD_KEY },
      params: { status: 'FINISHED', limit: 50 },
      timeout: 15000
    });
    res.json(response.data);
  } catch (error) {
    console.error('H2H error:', error.message);
    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.message,
      details: error.response?.data || null,
      matches: []
    });
  }
});

// ── WEATHER (Open-Meteo — free, no key, no rate limit concern) ──
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon, date } = req.query;
    const url = `https://api.open-meteo.com/v1/forecast`;
    const response = await axios.get(url, {
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
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── HEALTH CHECK ──
app.get('/health', (req, res) => {
  res.json({ status: 'SHARP ENGINE ONLINE', source: 'football-data.org', timestamp: new Date().toISOString() });
});

// ── ROOT ──
app.get('/', (req, res) => {
  res.json({ status: 'SHARP proxy running', source: 'football-data.org' });
});

app.listen(PORT, () => {
  console.log(`SHARP Proxy (football-data.org, rate-limited) running on port ${PORT}`);
});
