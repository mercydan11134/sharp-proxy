const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════
// API KEYS
// ═══════════════════════════════════════════════════════
const FD_KEY  = 'd6cc20230f8d4ee087dcaf0a3a8b5ee5';           // football-data.org  — 12 major leagues
const FD_HOST = 'https://api.football-data.org/v4';
const BSD_KEY = '3e46d7c80908d02d9558de0189687755e4f67e2b';    // BSD bzzoiro — 66 leagues, NO rate limits, NO suspensions
const BSD_HOST = 'https://sports.bzzoiro.com';

app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════
// COMPETITIONS COVERED BY football-data.org FREE TIER
// Everything else routes to BSD
// ═══════════════════════════════════════════════════════
const FD_COMPS = new Set(['WC','EC','CL','PL','ELC','PD','SA','BL1','FL1','PPL','DED','BSA','CLI','EL']);

// ═══════════════════════════════════════════════════════
// BSD LEAGUE ID MAP
// Maps SHARP competition codes to BSD league IDs
// These IDs come from BSD's /api/v2/leagues/ endpoint
// ═══════════════════════════════════════════════════════
const BSD_LEAGUE_IDS = {
  'UECL':        84,   // UEFA Conference League
  'AFCON':       6,    // Africa Cup of Nations
  'NL':          5,    // UEFA Nations League
  'COPA':        9,    // Copa America
  'FRIENDLY':    10,   // International Friendlies
  'WCQ_AF':      30,   // WC Qualification Africa
  'WCQ_EU':      32,   // WC Qualification Europe
  'WCQ_SA':      34,   // WC Qualification South America
  'NPFL':        301,  // Nigeria NPFL
  'EGY':         233,  // Egypt Premier League
  'RSA':         288,  // South Africa PSL
  'GHA':         363,  // Ghana Premier League
  'CIV':         384,  // Ivory Coast Ligue 1
  'MAR':         200,  // Morocco Botola Pro
  'TUN':         196,  // Tunisia Ligue 1
  'ALG':         197,  // Algeria Ligue Pro
  'CAF_CL':      12,   // CAF Champions League
  'ARG':         128,  // Argentine Primera
  'MLS':         253,  // MLS
  'LIGA_MX':     265,  // Liga MX
  'ALLSVENSKAN': 113,  // Swedish Allsvenskan
  'ELITESERIEN': 103,  // Norwegian Eliteserien
  'DANISH':      119,  // Danish Superliga
  'SPL':         179,  // Scottish Premiership
  'J_LEAGUE':    98,   // J League
  'K_LEAGUE':    292,  // K League
  'SUPER_LIG':   203,  // Turkish Super Lig
  'BEL':         144,  // Belgian Pro League
};

// ═══════════════════════════════════════════════════════
// RATE LIMITER — football-data.org only (10 req/min)
// BSD has NO rate limits — no throttling needed
// ═══════════════════════════════════════════════════════
let lastFD = 0;
const FD_GAP = 700;

async function fdGet(url, params = {}) {
  const now = Date.now();
  const wait = Math.max(0, lastFD + FD_GAP - now);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFD = Date.now();
  return axios.get(url, { headers: { 'X-Auth-Token': FD_KEY }, params, timeout: 15000 });
}

// BSD helper — Authorization: Token header required
async function bsdGet(path, params = {}) {
  return axios.get(`${BSD_HOST}${path}`, {
    headers: { 'Authorization': `Token ${BSD_KEY}`, 'Accept': 'application/json' },
    params,
    timeout: 15000
  });
}

// ═══════════════════════════════════════════════════════
// NORMALISE BSD EVENT to football-data.org format
// So SHARP frontend works identically regardless of source
// ═══════════════════════════════════════════════════════
function normBSD(e) {
  const homeGoals = e.home_score ?? e.score_home ?? null;
  const awayGoals = e.away_score ?? e.score_away ?? null;
  return {
    id: e.id,
    utcDate: e.event_date || e.date,
    status: e.status === 'finished' ? 'FINISHED' : 'SCHEDULED',
    isNeutralGround: e.is_neutral_ground || false,
    homeTeam: { id: e.home_team_id, name: e.home_team, shortName: e.home_team },
    awayTeam: { id: e.away_team_id, name: e.away_team, shortName: e.away_team },
    score: { fullTime: { home: homeGoals, away: awayGoals } },
    referees: e.referee ? [{ name: e.referee }] : [],
    // BSD bonus data — these power new SHARP features
    unavailablePlayers: e.unavailable_players || null,  // injuries auto-detected
    weather: e.weather || null,                         // weather from BSD
    oddsHome: e.odds_home || null,                      // opening odds embedded
    oddsDraw: e.odds_draw || null,
    oddsAway: e.odds_away || null,
    prediction: e.prediction || null,                   // ML prediction from BSD
    homeCoach: e.home_coach || null,
    awayCoach: e.away_coach || null,
    _source: 'bsd',
  };
}

// ═══════════════════════════════════════════════════════
// TEAMS ENDPOINT
// FD competitions: use football-data.org team roster
// BSD competitions: extract unique teams from recent events
// ═══════════════════════════════════════════════════════
app.get('/api/teams', async (req, res) => {
  const { competition } = req.query;
  if (!competition) return res.status(400).json({ error: 'competition required', teams: [] });

  try {
    if (FD_COMPS.has(competition)) {
      const r = await fdGet(`${FD_HOST}/competitions/${competition}/teams`);
      return res.json(r.data);
    }

    // BSD route
    const leagueId = BSD_LEAGUE_IDS[competition];
    if (!leagueId) {
      return res.json({ teams: [], _source: 'bsd', error: `No league ID for ${competition}` });
    }

    const season = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const r = await bsdGet('/api/v2/events/', { league: leagueId, season, limit: 100 });
    const events = r.data.results || [];

    const teamMap = new Map();
    events.forEach(e => {
      if (e.home_team_id && e.home_team) {
        teamMap.set(e.home_team_id, { id: e.home_team_id, name: e.home_team, shortName: e.home_team, _source: 'bsd' });
      }
      if (e.away_team_id && e.away_team) {
        teamMap.set(e.away_team_id, { id: e.away_team_id, name: e.away_team, shortName: e.away_team, _source: 'bsd' });
      }
    });

    return res.json({ teams: Array.from(teamMap.values()), _source: 'bsd', leagueId });
  } catch (e) {
    console.error('Teams error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, teams: [] });
  }
});

// ═══════════════════════════════════════════════════════
// TEAM NAME SEARCH — BSD direct search
// Fallback when team not found in competition roster
// ═══════════════════════════════════════════════════════
app.get('/api/search-team', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required', teams: [] });

  try {
    const r = await bsdGet('/api/v2/teams/', { search: name, limit: 5 });
    const teams = (r.data.results || []).map(t => ({
      id: t.id,
      name: t.name,
      shortName: t.short_name || t.name,
      country: t.country,
      _source: 'bsd'
    }));
    return res.json({ teams, _source: 'bsd' });
  } catch (e) {
    console.error('Team search error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, teams: [] });
  }
});

// ═══════════════════════════════════════════════════════
// TEAM MATCHES — Recent finished matches for stats calculation
// ═══════════════════════════════════════════════════════
app.get('/api/team-matches/:teamId', async (req, res) => {
  const { teamId } = req.params;
  const { source, limit } = req.query;

  try {
    if (source === 'bsd') {
      const r = await bsdGet('/api/v2/events/', {
        team: teamId,
        status: 'finished',
        limit: limit || 15,
        ordering: '-event_date'
      });
      return res.json({ matches: (r.data.results || []).map(normBSD) });
    } else {
      const r = await fdGet(`${FD_HOST}/teams/${teamId}/matches`, { status: 'FINISHED', limit: limit || 15 });
      return res.json(r.data);
    }
  } catch (e) {
    console.error('Team matches error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, matches: [] });
  }
});

// ═══════════════════════════════════════════════════════
// COMPETITION MATCHES — Fixtures by date (for referee + odds)
// ═══════════════════════════════════════════════════════
app.get('/api/competition-matches/:competition', async (req, res) => {
  const { competition } = req.params;
  const { dateFrom, dateTo } = req.query;

  try {
    if (FD_COMPS.has(competition)) {
      const r = await fdGet(`${FD_HOST}/competitions/${competition}/matches`, { dateFrom, dateTo });
      return res.json(r.data);
    }

    const leagueId = BSD_LEAGUE_IDS[competition];
    if (!leagueId) return res.json({ matches: [] });

    const r = await bsdGet('/api/v2/events/', {
      league: leagueId,
      date_from: dateFrom,
      date_to: dateTo || dateFrom,
      limit: 50
    });
    return res.json({ matches: (r.data.results || []).map(normBSD) });
  } catch (e) {
    console.error('Competition matches error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, matches: [] });
  }
});

// ═══════════════════════════════════════════════════════
// STANDINGS
// ═══════════════════════════════════════════════════════
app.get('/api/standings/:competition', async (req, res) => {
  const { competition } = req.params;

  try {
    if (FD_COMPS.has(competition)) {
      const r = await fdGet(`${FD_HOST}/competitions/${competition}/standings`);
      return res.json(r.data);
    }

    const leagueId = BSD_LEAGUE_IDS[competition];
    if (!leagueId) return res.json({ standings: [] });

    const season = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const r = await bsdGet('/api/v2/standings/', { league: leagueId, season });
    const rows = r.data.results || r.data.standings || r.data || [];

    const table = (Array.isArray(rows) ? rows : []).map((row, i) => ({
      position: row.rank || row.position || i + 1,
      team: {
        id: row.team_id || row.team?.id || i,
        name: row.team_name || row.team?.name || row.name || '',
        shortName: row.team_name || row.team?.name || row.name || ''
      },
      playedGames: row.played || row.games_played || row.mp || 0,
      points: row.points || 0,
      won: row.won || row.w || 0,
      draw: row.drawn || row.draw || row.d || 0,
      lost: row.lost || row.l || 0,
      goalsFor: row.goals_for || row.scored || row.gf || 0,
      goalsAgainst: row.goals_against || row.conceded || row.ga || 0,
    }));

    return res.json({ standings: [{ table }], _source: 'bsd' });
  } catch (e) {
    console.error('Standings error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, standings: [] });
  }
});

// ═══════════════════════════════════════════════════════
// H2H
// ═══════════════════════════════════════════════════════
app.get('/api/h2h/:teamId', async (req, res) => {
  const { teamId } = req.params;
  const { source } = req.query;

  try {
    if (source === 'bsd') {
      const r = await bsdGet('/api/v2/events/', {
        team: teamId,
        status: 'finished',
        limit: 50,
        ordering: '-event_date'
      });
      return res.json({ matches: (r.data.results || []).map(normBSD) });
    } else {
      const r = await fdGet(`${FD_HOST}/teams/${teamId}/matches`, { status: 'FINISHED', limit: 50 });
      return res.json(r.data);
    }
  } catch (e) {
    console.error('H2H error:', e.message);
    res.status(e.response?.status || 500).json({ error: e.message, matches: [] });
  }
});

// ═══════════════════════════════════════════════════════
// MATCH DETAILS — Full event data including injuries, odds, referee
// Called to get the specific match for a date
// ═══════════════════════════════════════════════════════
app.get('/api/match-details', async (req, res) => {
  const { homeTeam, awayTeam, date, competition } = req.query;

  try {
    let events = [];

    if (FD_COMPS.has(competition)) {
      // Use FD for these competitions
      const r = await fdGet(`${FD_HOST}/competitions/${competition}/matches`, {
        dateFrom: date,
        dateTo: date
      });
      events = (r.data.matches || []).map(m => ({
        home_team: m.homeTeam?.name,
        away_team: m.awayTeam?.name,
        referee: m.referees?.[0]?.name || null,
        is_neutral_ground: false,
        unavailable_players: null,
        odds_home: null,
        odds_draw: null,
        odds_away: null,
        _source: 'fd'
      }));
    } else {
      const leagueId = BSD_LEAGUE_IDS[competition];
      const params = { date_from: date, date_to: date, limit: 50 };
      if (leagueId) params.league = leagueId;
      const r = await bsdGet('/api/v2/events/', params);
      events = (r.data.results || []).map(normBSD).map(e => ({
        ...e,
        home_team: e.homeTeam.name,
        away_team: e.awayTeam.name,
        referee: e.referees?.[0]?.name || null,
      }));
    }

    const hn = (homeTeam || '').toLowerCase();
    const an = (awayTeam || '').toLowerCase();
    const match = events.find(e =>
      (e.home_team?.toLowerCase().includes(hn) || hn.includes(e.home_team?.toLowerCase() || 'zzz')) &&
      (e.away_team?.toLowerCase().includes(an) || an.includes(e.away_team?.toLowerCase() || 'zzz'))
    );

    return res.json({ match: match || null });
  } catch (e) {
    console.error('Match details error:', e.message);
    res.status(500).json({ error: e.message, match: null });
  }
});

// ═══════════════════════════════════════════════════════
// WEATHER (Open-Meteo — free, no key, no limits)
// ═══════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'SHARP ENGINE ONLINE',
    version: '10.0',
    sources: {
      'football-data.org': '12 major leagues — rate limited 10/min',
      'BSD bzzoiro.com': '66 leagues — NO rate limits — NO suspensions — includes injuries + odds + neutral venue',
      'open-meteo.com': 'weather — free unlimited'
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'SHARP proxy v10.0 — FD + BSD dual API', no_limits: true });
});

app.listen(PORT, () => {
  console.log('SHARP Proxy v10.0 (football-data.org + BSD no-limits) running on port', PORT);
});
