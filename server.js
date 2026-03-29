const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security ---

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "https:", "data:"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'"]
    }
  }
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET'],
  credentials: false
}));

// rate limit: 30 requests per minute per IP
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please wait a moment.' }
});
app.use('/api/', limiter);

// serve frontend files
app.use(express.static(path.join(__dirname, 'public')));

// --- Input helpers ---

const ALLOWED_COUNTRIES = ['gb', 'us', 'au', 'at', 'br', 'ca', 'de', 'fr', 'in', 'it', 'nl', 'nz', 'pl', 'sg', 'za'];

function sanitize(str) {
  if (!str) return '';
  // strip HTML tags, then remove characters that are not letters (including accented),
  // numbers, spaces, hyphens, commas, or apostrophes
  return String(str)
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N} \-,.']/gu, '')
    .trim()
    .slice(0, 100);
}

function isValidCountry(code) {
  return ALLOWED_COUNTRIES.includes(String(code).toLowerCase());
}

// --- Remotive cache (30 min) ---

let remotiveCache = { data: null, timestamp: 0 };
const CACHE_DURATION = 30 * 60 * 1000;

// --- API Routes ---

// local jobs (Adzuna)
app.get('/api/jobs/local', async (req, res) => {
  try {
    const keyword = sanitize(req.query.keyword);
    const country = String(req.query.country || 'gb').toLowerCase();
    const city = sanitize(req.query.city);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const sort = ['salary', 'date', 'relevance'].includes(req.query.sort) ? req.query.sort : 'relevance';
    const salaryMin = parseInt(req.query.salary_min) || undefined;
    const salaryMax = parseInt(req.query.salary_max) || undefined;
    const jobType = req.query.job_type || '';

    if (!keyword) {
      return res.status(400).json({ error: 'Please enter a job title or keyword.' });
    }

    if (!isValidCountry(country)) {
      return res.status(400).json({ error: 'Invalid country code.' });
    }

    const params = {
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      what: keyword,
      results_per_page: 20,
      sort_by: sort === 'relevance' ? 'relevance' : sort,
    };

    if (city) params.where = city;
    if (salaryMin) params.salary_min = salaryMin;
    if (salaryMax) params.salary_max = salaryMax;
    if (jobType === 'full_time') params.full_time = 1;
    if (jobType === 'part_time') params.part_time = 1;
    if (jobType === 'contract') params.contract = 1;
    if (jobType === 'permanent') params.permanent = 1;

    const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`;
    const response = await axios.get(url, { params, timeout: 10000 });

    const jobs = (response.data.results || []).map(job => ({
      id: job.id,
      title: job.title,
      company: job.company?.display_name || 'Unknown',
      location: job.location?.display_name || 'Not specified',
      salary_min: job.salary_min || null,
      salary_max: job.salary_max || null,
      description: job.description || '',
      url: job.redirect_url,
      date: job.created,
      category: job.category?.label || '',
      contract_type: job.contract_type || '',
      contract_time: job.contract_time || '',
    }));

    res.json({
      total: response.data.count || 0,
      page,
      jobs,
    });

  } catch (err) {
    if (err.response && err.response.status === 401) {
      return res.status(500).json({ error: 'API authentication failed. Check server configuration.' });
    }
    res.status(500).json({ error: 'Could not fetch local jobs. Please try again later.' });
  }
});

// remote jobs (Remotive)
app.get('/api/jobs/remote', async (req, res) => {
  try {
    const keyword = sanitize(req.query.keyword);
    const category = sanitize(req.query.category);

    // use cache if fresh
    const now = Date.now();
    let allJobs;

    if (remotiveCache.data && (now - remotiveCache.timestamp) < CACHE_DURATION) {
      allJobs = remotiveCache.data;
    } else {
      const params = {};
      if (category) params.category = category;

      const response = await axios.get('https://remotive.com/api/remote-jobs', {
        params,
        timeout: 10000
      });

      allJobs = (response.data.jobs || []).map(job => ({
        id: job.id,
        title: job.title,
        company: job.company_name || 'Unknown',
        company_logo: job.company_logo || null,
        location: job.candidate_required_location || 'Worldwide',
        salary: job.salary || '',
        description: job.description || '',
        url: job.url,
        date: job.publication_date,
        category: job.category || '',
        job_type: job.job_type || '',
      }));

      // save to cache
      remotiveCache = { data: allJobs, timestamp: now };
    }

    // filter by keyword on the server
    let filtered = allJobs;
    if (keyword) {
      const lower = keyword.toLowerCase();
      filtered = allJobs.filter(job =>
        job.title.toLowerCase().includes(lower) ||
        job.company.toLowerCase().includes(lower) ||
        job.description.toLowerCase().includes(lower)
      );
    }

    // filter by category if cache was used with different category
    if (category) {
      const catLower = category.toLowerCase().replace(/-/g, ' ');
      filtered = filtered.filter(job =>
        job.category.toLowerCase().replace(/-/g, ' ').includes(catLower)
      );
    }

    res.json({
      total: filtered.length,
      jobs: filtered,
    });

  } catch (err) {
    res.status(500).json({ error: 'Could not fetch remote jobs. Please try again later.' });
  }
});

// remote job categories
app.get('/api/categories/remote', (req, res) => {
  res.json({
    categories: [
      { slug: 'software-dev', name: 'Software Development' },
      { slug: 'customer-support', name: 'Customer Support' },
      { slug: 'design', name: 'Design' },
      { slug: 'marketing', name: 'Marketing' },
      { slug: 'sales', name: 'Sales' },
      { slug: 'product', name: 'Product' },
      { slug: 'business', name: 'Business' },
      { slug: 'data', name: 'Data' },
      { slug: 'devops', name: 'DevOps / Sysadmin' },
      { slug: 'finance', name: 'Finance / Legal' },
      { slug: 'human-resources', name: 'Human Resources' },
      { slug: 'qa', name: 'QA' },
      { slug: 'writing', name: 'Writing' },
      { slug: 'all-others', name: 'All Others' },
    ]
  });
});

// local job categories (Adzuna)
app.get('/api/categories/local/:country', async (req, res) => {
  try {
    const country = String(req.params.country).toLowerCase();
    if (!isValidCountry(country)) {
      return res.status(400).json({ error: 'Invalid country code.' });
    }

    const url = `https://api.adzuna.com/v1/api/jobs/${country}/categories`;
    const response = await axios.get(url, {
      params: {
        app_id: process.env.ADZUNA_APP_ID,
        app_key: process.env.ADZUNA_APP_KEY,
      },
      timeout: 10000
    });

    res.json({ categories: response.data.results || [] });

  } catch (err) {
    res.status(500).json({ error: 'Could not fetch categories.' });
  }
});

// map country code to full name for Adzuna location0 param
const COUNTRY_NAMES = {
  gb: 'UK', us: 'US', au: 'Australia', at: 'Austria', br: 'Brazil',
  ca: 'Canada', de: 'Germany', fr: 'France', in: 'India', it: 'Italy',
  nl: 'Netherlands', nz: 'New Zealand', pl: 'Poland', sg: 'Singapore', za: 'South Africa'
};

// salary histogram — shows how many jobs at each pay level
app.get('/api/salary/histogram', async (req, res) => {
  try {
    const keyword = sanitize(req.query.keyword);
    const country = String(req.query.country || 'gb').toLowerCase();
    const city = sanitize(req.query.city);

    if (!keyword) return res.status(400).json({ error: 'Keyword is required.' });
    if (!isValidCountry(country)) return res.status(400).json({ error: 'Invalid country code.' });

    const params = {
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      what: keyword,
      location0: COUNTRY_NAMES[country] || country.toUpperCase(),
    };
    if (city) params.location1 = city;

    const url = `https://api.adzuna.com/v1/api/jobs/${country}/histogram`;
    const response = await axios.get(url, { params, timeout: 10000 });

    const histogram = response.data.histogram || {};
    if (Object.keys(histogram).length === 0) {
      return res.json({ histogram: {} });
    }

    res.json({ histogram });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch salary histogram.' });
  }
});

// salary history — shows average salary per month over time
app.get('/api/salary/history', async (req, res) => {
  try {
    const keyword = sanitize(req.query.keyword);
    const country = String(req.query.country || 'gb').toLowerCase();
    const city = sanitize(req.query.city);

    if (!keyword) return res.status(400).json({ error: 'Keyword is required.' });
    if (!isValidCountry(country)) return res.status(400).json({ error: 'Invalid country code.' });

    const params = {
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      what: keyword,
      location0: COUNTRY_NAMES[country] || country.toUpperCase(),
    };
    if (city) params.location1 = city;

    const url = `https://api.adzuna.com/v1/api/jobs/${country}/history`;
    const response = await axios.get(url, { params, timeout: 10000 });

    const month = response.data.month || {};
    if (Object.keys(month).length === 0) {
      return res.json({ month: {} });
    }

    res.json({ month });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch salary history.' });
  }
});

// health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// all other routes serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`KaziHunt server running on port ${PORT}`);
});
