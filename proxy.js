const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Your API keys - stored safely on the server
const AF_KEY = '530233bbf469bf14e2e7f8077fefaae1';
const AF_HOST = 'v3.football.api-sports.io';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── API FOOTBALL PROXY ──
app.get('/api/football/:endpoint(*)', async (req, res) => {
  try {
    const endpoint = req.params.endpoint;
    const query = req.query;
    const url = `https://${AF_HOST}/${endpoint}`;

    console.log(`Fetching: ${url}`, query);

    const response = await axios.get(url, {
      params: query,
      headers: {
        'x-apisports-key': AF_KEY,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    res.json(response.data);
  } catch (error) {
    console.error('API Error:', error.message);
    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.message,
      status: status,
      response: []
    });
  }
});

// ── WEATHER PROXY ──
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
  res.json({ status: 'SHARP ENGINE ONLINE', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`SHARP Proxy running on port ${PORT}`);
});
