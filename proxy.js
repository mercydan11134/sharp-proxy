const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ── API KEYS ──
const FD_KEY = 'd6cc20230f8d4ee087dcaf0a3a8b5ee5';   // football-data.org (13 major competitions)
const FD_HOST = 'https://api.football-data.org/v4';
const AF_KEY = '2c1b2304c16908409b44f58721c9864d';    // api-football.com (1200+ competitions)
const AF_HOST = 'https://v3.football.api-sports.io';
const ODDS_KEY = '1c13328b';                           // OddsPapi (odds + line movement)
const ODDS_HOST = 'https://api.oddspapi.io';

app.use(cors());
app.use(express.json());

// ── COMPETITIONS COVERED BY football-data.org FREE TIER ──
// Everything else falls to api-football.com
const FD_COMPS = new Set(['WC','EC','CL','PL','ELC','PD','SA','BL1','FL1','PPL','DED','BSA','CLI','EL']);

// ── API-FOOTBALL COMPETITION ID MAP ──
// Maps SHARP competition codes to api-football.com league IDs
const AF_LEAGUE_MAP = {
  'UECL': 848,       // UEFA Conference League
  'AFCON': 6,        // Africa Cup of Nations
  'NL': 5,           // UEFA Nations League
  'FRIENDLY': 10,    // International Friendlies
  'COPA': 9,         // Copa America
  'WCQ_AF': 30,      // World Cup Qualification Africa
  'WCQ_EU': 32,      // World Cup Qualification Europe
  'WCQ_SA': 34,      // World Cup Qualification South America
  'NPFL': 667,       // Nigeria NPFL
  'EGY': 233,        // Egypt Premier League
  'RSA': 288,        // South Africa PSL
  'GHA': 363,        // Ghana Premier League
  'CIV': 384,        // Ivory Coast Ligue 1
  'MAR': 686,        // Morocco Botola Pro
  'TUN': 196,        // Tunisia Ligue 1
  'ALG': 200,        // Algeria Ligue Pro
  'CAF_CL': 12,      // CAF Champions League
  'CAF_CC': 20,      // CAF Confederation Cup
  'BRA_B': 72,       // Brasileirao Serie B
  'ARG': 128,        // Argentine Primera Division
  'MLS': 253,        // MLS
  'LIGA_MX': 265,    // Liga MX
  'EREDIVISIE': 88,  // Eredivisie (backup)
  'SPL': 179,        // Scottish Premiership
  'SUPER_LIG': 203,  // Turkish Super Lig
  'ALLSVENSKAN': 113,// Swedish Allsvenskan
  'ELITESERIEN': 103,// Norwegian Eliteserien
  'DANISH': 119,     // Danish Superliga
  'J_LEAGUE': 98,    // J League
  'K_LEAGUE': 292,   // K League
};

// ── RATE LIMITERS ──
let lastFDRequest = 0;
const FD_GAP = 700; // football-data.org: 10 req/min

let lastAFRequest = 0;
const AF_GAP = 400; // api-football.com: 30 req/min on free tier

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

async function afGet(url, params = {}) {
  const now = Date.now();
  const wait = Math.max(0, lastAFRequest + AF_GAP - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastAFRequest = Date.now();
  return axios.get(url, {
    headers: { 'x-apisports-key': AF_KEY },
    params,
    timeout: 15000
  });
}

// ══════════════════════════════════════════════════
// HELPER — detect which API to use
// ══════════════════════════════════════════════════
function usesFD(comp) {
  return FD_COMPS.has(comp);
}

// ══════════════════════════════════════════════════
// TEAMS ENDPOINT
// Returns teams in a competition — used for team search
// ══════════════════════════════════════════════════
app.get('/api/teams', async (req, res) => {
  const { competition } = req.query;
  if (!competition) return res.status(400).json({ error: 'competition required', teams: [] });

  try {
    if (usesFD(competition)) {
      // football-data.org
      const r = await fdGet(`${FD_HOST}/competitions/${competition}/teams`);
      return res.json(r.data);
    } else {
      // api-football.com — get teams for this league
      const leagueId = AF_LEAGUE_MAP[competition];
      if (!leagueId) return res.status(400).json({ error: `Unknown competition: ${competition}`, teams: [] });
      const season = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
      const r = await afGet(`${AF_HOST}/teams`, { league: leagueId, season });
      // Normalise to football-data.org format so SHARP frontend works identically
      const teams = (r.data.response || []).map(t => ({
        id: t.team.id,
        name: t.team.name,
        shortName: t.team.name,
        tla: t.team.code,
        _source: 'af'
      }));
      return res.json({ teams, _source: 'af', leagueId });
    }
  } catch (e) {
    console.error('Teams error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, teams: [] });
  }
});

// ══════════════════════════════════════════════════
// TEAM MATCHES ENDPOINT
// Returns recent finished matches for a team
// ══════════════════════════════════════════════════
app.get('/api/team-matches/:teamId', async (req, res) => {
  const { teamId } = req.params;
  const { status, limit, source } = req.query;

  try {
    if (source === 'af') {
      // api-football.com team matches
      const r = await afGet(`${AF_HOST}/fixtures`, {
        team: teamId,
        last: limit || 15,
        status: 'FT'
      });
      // Normalise to football-data.org match format
      const matches = (r.data.response || []).map(f => ({
        id: f.fixture.id,
        utcDate: f.fixture.date,
        status: 'FINISHED',
        homeTeam: { id: f.teams.home.id, name: f.teams.home.name, shortName: f.teams.home.name },
        awayTeam: { id: f.teams.away.id, name: f.teams.away.name, shortName: f.teams.away.name },
        score: {
          fullTime: { home: f.goals.home, away: f.goals.away },
          halfTime: { home: f.score.halftime.home, away: f.score.halftime.away }
        }
      }));
      return res.json({ matches });
    } else {
      // football-data.org
      const r = await fdGet(`${FD_HOST}/teams/${teamId}/matches`, {
        status: status || 'FINISHED',
        limit: limit || 15
      });
      return res.json(r.data);
    }
  } catch (e) {
    console.error('Team matches error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, matches: [] });
  }
});

// ══════════════════════════════════════════════════
// COMPETITION MATCHES ENDPOINT
// Returns fixtures for a competition on a specific date
// ══════════════════════════════════════════════════
app.get('/api/competition-matches/:competition', async (req, res) => {
  const { competition } = req.params;
  const { dateFrom, dateTo } = req.query;

  try {
    if (usesFD(competition)) {
      const r = await fdGet(`${FD_HOST}/competitions/${competition}/matches`, { dateFrom, dateTo });
      return res.json(r.data);
    } else {
      const leagueId = AF_LEAGUE_MAP[competition];
      if (!leagueId) return res.json({ matches: [] });
      const season = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
      const r = await afGet(`${AF_HOST}/fixtures`, { league: leagueId, season, date: dateFrom });
      const matches = (r.data.response || []).map(f => ({
        id: f.fixture.id,
        utcDate: f.fixture.date,
        status: f.fixture.status.short === 'FT' ? 'FINISHED' : 'SCHEDULED',
        homeTeam: { id: f.teams.home.id, name: f.teams.home.name, shortName: f.teams.home.name },
        awayTeam: { id: f.teams.away.id, name: f.teams.away.name, shortName: f.teams.away.name },
        referees: f.fixture.referee ? [{ name: f.fixture.referee }] : [],
        score: {
          fullTime: { home: f.goals.home, away: f.goals.away }
        }
      }));
      return res.json({ matches });
    }
  } catch (e) {
    console.error('Competition matches error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, matches: [] });
  }
});

// ══════════════════════════════════════════════════
// STANDINGS ENDPOINT
// ══════════════════════════════════════════════════
app.get('/api/standings/:competition', async (req, res) => {
  const { competition } = req.params;

  try {
    if (usesFD(competition)) {
      const r = await fdGet(`${FD_HOST}/competitions/${competition}/standings`);
      return res.json(r.data);
    } else {
      const leagueId = AF_LEAGUE_MAP[competition];
      if (!leagueId) return res.json({ standings: [] });
      const season = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
      const r = await afGet(`${AF_HOST}/standings`, { league: leagueId, season });
      // Normalise to football-data.org standings format
      const table = ((r.data.response || [])[0]?.league?.standings || [[]])[0] || [];
      const normalised = table.map(row => ({
        position: row.rank,
        team: { id: row.team.id, name: row.team.name, shortName: row.team.name },
        playedGames: row.all.played,
        won: row.all.win,
        draw: row.all.draw,
        lost: row.all.lose,
        points: row.points,
        goalsFor: row.all.goals.for,
        goalsAgainst: row.all.goals.against,
        goalDifference: row.goalsDiff,
        form: row.form
      }));
      return res.json({ standings: [{ table: normalised }] });
    }
  } catch (e) {
    console.error('Standings error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, standings: [] });
  }
});

// ══════════════════════════════════════════════════
// H2H ENDPOINT
// ══════════════════════════════════════════════════
app.get('/api/h2h/:teamId', async (req, res) => {
  const { teamId } = req.params;
  const { source } = req.query;

  try {
    if (source === 'af') {
      // For AF teams, get last 50 matches and filter H2H client-side
      const r = await afGet(`${AF_HOST}/fixtures`, { team: teamId, last: 50, status: 'FT' });
      const matches = (r.data.response || []).map(f => ({
        id: f.fixture.id,
        utcDate: f.fixture.date,
        status: 'FINISHED',
        homeTeam: { id: f.teams.home.id, name: f.teams.home.name, shortName: f.teams.home.name },
        awayTeam: { id: f.teams.away.id, name: f.teams.away.name, shortName: f.teams.away.name },
        score: { fullTime: { home: f.goals.home, away: f.goals.away } }
      }));
      return res.json({ matches });
    } else {
      const r = await fdGet(`${FD_HOST}/teams/${teamId}/matches`, {
        status: 'FINISHED',
        limit: 50
      });
      return res.json(r.data);
    }
  } catch (e) {
    console.error('H2H error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, matches: [] });
  }
});

// ══════════════════════════════════════════════════
// ODDS ENDPOINTS (OddsPapi)
// ══════════════════════════════════════════════════
app.get('/api/odds/search', async (req, res) => {
  try {
    const { homeTeam, awayTeam, date } = req.query;
    const r = await axios.get(`${ODDS_HOST}/fixtures`, {
      params: { apiKey: ODDS_KEY, sportId: 10, date },
      timeout: 15000
    });
    const fixtures = r.data?.data || r.data || [];
    const hn = homeTeam.toLowerCase(), an = awayTeam.toLowerCase();
    const match = fixtures.find(f => {
      const h = (f.home || f.homeTeam || '').toLowerCase();
      const a = (f.away || f.awayTeam || '').toLowerCase();
      return (h.includes(hn) || hn.includes(h)) && (a.includes(an) || an.includes(a));
    });
    res.json({ fixture: match || null });
  } catch (e) {
    console.error('Odds search error:', e.message);
    res.status(500).json({ error: e.message, fixture: null });
  }
});

app.get('/api/odds/match', async (req, res) => {
  try {
    const { fixtureId, marketId } = req.query;
    const r = await axios.get(`${ODDS_HOST}/odds`, {
      params: { apiKey: ODDS_KEY, fixtureId, marketId: marketId || 1 },
      timeout: 15000
    });
    res.json(r.data);
  } catch (e) {
    console.error('Odds match error:', e.message);
    res.status(500).json({ error: e.message, data: [] });
  }
});

// ══════════════════════════════════════════════════
// WEATHER (Open-Meteo — free, no key needed)
// ══════════════════════════════════════════════════
app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon, date } = req.query;
    const r = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat, longitude: lon,
        hourly: 'temperature_2m,precipitation,windspeed_10m',
        timezone: 'auto', start_date: date, end_date: date
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
    sources: ['football-data.org (13 competitions)', 'api-football.com (1200+ competitions)', 'oddspapi.io', 'open-meteo.com'],
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'SHARP proxy v9.0', dual_api: true });
});

app.listen(PORT, () => {
  console.log(`SHARP Proxy v9.0 (dual API) running on port ${PORT}`);
});
